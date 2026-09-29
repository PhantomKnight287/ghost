package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// webhookPayload is what the API puts in delivery_job.payload for kind 'webhook'.
// Body is the JSON the receiver gets, frozen at fan-out so a retry sends the same bytes.
type webhookPayload struct {
	Event string `json:"event"`
	Body  string `json:"body"`
}

// Stored response bodies are cut to this; the delivery log only needs a glance.
const maxResponseBody = 4 << 10

type webhookSender struct {
	db     *pgxpool.Pool
	client *http.Client
	key    []byte // AES-256 key for webhook_endpoint.secret, from WEBHOOK_SECRET_KEY
	hosts  *hostLimiter
}

// A job that finds its host busy waits this long; it is not the receiver's fault, so it records no attempt.
const hostBusyRetry = 5 * time.Second

func (w webhookSender) send(ctx context.Context, j Job) error {
	if j.EndpointID == nil {
		return permanentError{errors.New("webhook job has no endpoint_id")}
	}
	var p webhookPayload
	if err := json.Unmarshal(j.Payload, &p); err != nil {
		return permanentError{fmt.Errorf("decode webhook payload: %w", err)}
	}

	// Read at send time: the endpoint may have been disabled or its URL changed since enqueue.
	var (
		url, sealed string
		active      bool
	)
	err := w.db.QueryRow(ctx,
		`SELECT url, secret, active FROM webhook_endpoint WHERE id = $1`, *j.EndpointID,
	).Scan(&url, &sealed, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		return permanentError{errors.New("endpoint was deleted")}
	}
	if err != nil {
		return err
	}
	if !active {
		return permanentError{errors.New("endpoint is disabled")}
	}
	secret, err := openSecret(w.key, sealed)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(p.Body))
	if err != nil {
		return permanentError{err}
	}
	for k, v := range signedHeaders(secret, j.ID, p.Event, []byte(p.Body), time.Now()) {
		req.Header.Set(k, v)
	}

	if !w.hosts.acquire(req.URL.Host) {
		return retryAfterError{fmt.Errorf("too many deliveries in flight to %s", req.URL.Host), hostBusyRetry}
	}
	defer w.hosts.release(req.URL.Host)

	started := time.Now()
	res, sendErr := w.client.Do(req)
	var (
		status  *int
		resBody *string
	)
	if sendErr == nil {
		b, _ := io.ReadAll(io.LimitReader(res.Body, maxResponseBody))
		res.Body.Close()
		status, resBody = &res.StatusCode, ptr(string(b))
	}
	w.recordAttempt(ctx, j.ID, started, req.Header, status, resBody, sendErr)

	if sendErr != nil {
		return sendErr
	}
	return w.classify(ctx, *j.EndpointID, res)
}

// classify turns a response into the job's next step.
func (w webhookSender) classify(ctx context.Context, endpointID string, res *http.Response) error {
	switch code := res.StatusCode; {
	case code >= 200 && code <= 299:
		return nil
	case code == http.StatusGone:
		_, err := w.db.Exec(ctx, `
			UPDATE webhook_endpoint
			SET active = false, disabled_reason = 'The endpoint responded 410 Gone.', updated_at = now()
			WHERE id = $1`, endpointID)
		if err != nil {
			return err
		}
		return permanentError{errors.New("endpoint responded 410 Gone and was disabled")}
	case code == http.StatusTooManyRequests:
		err := fmt.Errorf("endpoint responded %d", code)
		if after, ok := parseRetryAfter(res.Header.Get("Retry-After"), time.Now()); ok {
			return retryAfterError{err, after}
		}
		return err
	default:
		// ponytail: every other status retries with backoff, 4xx included; a receiver fixing its config then catches up. Fail fast on 4xx if retries waste too much.
		return fmt.Errorf("endpoint responded %d", code)
	}
}

// recordAttempt writes one delivery_attempt row. A failure to write it is logged, not fatal:
// the job's own result matters more than its log line.
func (w webhookSender) recordAttempt(ctx context.Context, jobID string, started time.Time, headers http.Header, status *int, body *string, sendErr error) {
	flat := make(map[string]string, len(headers))
	for k := range headers {
		flat[k] = headers.Get(k)
	}
	var errText *string
	if sendErr != nil {
		errText = ptr(sendErr.Error())
	}
	_, err := w.db.Exec(ctx, `
		INSERT INTO delivery_attempt (job_id, started_at, duration_ms, status_code, error, request_headers, response_body)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		jobID, started, time.Since(started).Milliseconds(), status, errText, flat, body)
	if err != nil {
		log.Printf("job %s: record attempt: %v", jobID, err)
	}
}

// signedHeaders signs "<timestamp>.<body>" so a receiver can reject replays older
// than a few minutes. X-Hub-Signature-256 signs the body alone, for GitHub-style receivers.
func signedHeaders(secret []byte, deliveryID, event string, body []byte, now time.Time) map[string]string {
	ts := strconv.FormatInt(now.Unix(), 10)
	return map[string]string{
		"Content-Type":          "application/json",
		"User-Agent":            "Ghost-Hookshot/1",
		"X-Ghost-Event":         event,
		"X-Ghost-Delivery":      deliveryID,
		"X-Ghost-Timestamp":     ts,
		"X-Ghost-Signature-256": "sha256=" + hmacHex(secret, []byte(ts+"."), body),
		"X-Hub-Signature-256":   "sha256=" + hmacHex(secret, body),
	}
}

func hmacHex(secret []byte, parts ...[]byte) string {
	mac := hmac.New(sha256.New, secret)
	for _, p := range parts {
		mac.Write(p)
	}
	return hex.EncodeToString(mac.Sum(nil))
}

// openSecret decrypts webhook_endpoint.secret, stored as
// "v1:" + base64(12-byte nonce || AES-256-GCM ciphertext and tag).
func openSecret(key []byte, sealed string) ([]byte, error) {
	if len(key) == 0 {
		return nil, errors.New("WEBHOOK_SECRET_KEY is not set")
	}
	raw, ok := strings.CutPrefix(sealed, "v1:")
	if !ok {
		return nil, errors.New("webhook secret has an unknown format")
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("webhook secret: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < gcm.NonceSize() {
		return nil, errors.New("webhook secret is too short")
	}
	nonce, ciphertext := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("webhook secret: %w", err)
	}
	return plain, nil
}

// parseRetryAfter reads Retry-After as seconds or an HTTP date.
func parseRetryAfter(v string, now time.Time) (time.Duration, bool) {
	if v == "" {
		return 0, false
	}
	if s, err := strconv.Atoi(v); err == nil && s >= 0 {
		return time.Duration(s) * time.Second, true
	}
	if t, err := http.ParseTime(v); err == nil {
		return max(t.Sub(now), 0), true
	}
	return 0, false
}

func ptr[T any](v T) *T { return &v }
