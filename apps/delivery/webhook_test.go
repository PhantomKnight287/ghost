package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestBlocked(t *testing.T) {
	tests := []struct {
		addr                      string
		blockedStrict, blockedLAN bool
	}{
		{"93.184.216.34", false, false},
		{"2606:2800:220:1::1", false, false},
		{"127.0.0.1", true, false},
		{"::1", true, false},
		{"10.1.2.3", true, false},
		{"172.16.0.1", true, false},
		{"192.168.1.4", true, false},
		{"100.64.0.1", true, false},
		{"fd00::1", true, false},
		{"::ffff:127.0.0.1", true, false}, // IPv4-mapped loopback
		{"169.254.169.254", true, true},   // cloud metadata, never allowed
		{"::ffff:169.254.169.254", true, true},
		{"fe80::1", true, true},
		{"0.0.0.0", true, true},
		{"224.0.0.1", true, true},
	}
	for _, tt := range tests {
		a := netip.MustParseAddr(tt.addr)
		if got := blocked(a, false); got != tt.blockedStrict {
			t.Errorf("blocked(%s, strict) = %v, want %v", tt.addr, got, tt.blockedStrict)
		}
		if got := blocked(a, true); got != tt.blockedLAN {
			t.Errorf("blocked(%s, allowPrivate) = %v, want %v", tt.addr, got, tt.blockedLAN)
		}
	}
}

func TestWebhookClientRefusesLoopbackOnTheDialedIP(t *testing.T) {
	hits := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits <- struct{}{} }))
	defer srv.Close()

	// "localhost" resolves to 127.0.0.1: the check runs after DNS, on the real address.
	url := "http://localhost:" + strconv.Itoa(srv.Listener.Addr().(*net.TCPAddr).Port)
	_, err := newWebhookClient(false).Get(url)
	if !errors.Is(err, errBlockedAddress) {
		t.Fatalf("err = %v, want errBlockedAddress", err)
	}
	if len(hits) > 0 {
		t.Error("request reached the loopback server")
	}
}

func TestSignedHeaders(t *testing.T) {
	secret, body := []byte("s3cret"), []byte(`{"action":"opened"}`)
	now := time.Unix(1_700_000_000, 0)
	h := signedHeaders(secret, "job-1", "issue.opened", body, now)

	if h["X-Ghost-Timestamp"] != "1700000000" || h["X-Ghost-Delivery"] != "job-1" || h["X-Ghost-Event"] != "issue.opened" {
		t.Errorf("headers = %v", h)
	}
	// What a receiver computes: HMAC over "<timestamp>.<raw body>".
	if want := "sha256=" + hmacHex(secret, []byte("1700000000."+string(body))); h["X-Ghost-Signature-256"] != want {
		t.Errorf("X-Ghost-Signature-256 = %s, want %s", h["X-Ghost-Signature-256"], want)
	}
	if want := "sha256=" + hmacHex(secret, body); h["X-Hub-Signature-256"] != want {
		t.Errorf("X-Hub-Signature-256 = %s, want %s", h["X-Hub-Signature-256"], want)
	}
}

func TestOpenSecret(t *testing.T) {
	key := make([]byte, 32)
	rand.Read(key)
	got, err := openSecret(key, sealSecret(t, key, "whsec_abc"))
	if err != nil || string(got) != "whsec_abc" {
		t.Fatalf("openSecret = %q, %v", got, err)
	}
	other := make([]byte, 32)
	if _, err := openSecret(other, sealSecret(t, key, "whsec_abc")); err == nil {
		t.Error("opened a secret with the wrong key")
	}
}

func TestParseRetryAfter(t *testing.T) {
	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		v    string
		want time.Duration
		ok   bool
	}{
		{"120", 2 * time.Minute, true},
		{"Tue, 29 Sep 2026 12:05:00 GMT", 5 * time.Minute, true},
		{"", 0, false},
		{"soon", 0, false},
	}
	for _, tt := range tests {
		got, ok := parseRetryAfter(tt.v, now)
		if got != tt.want || ok != tt.ok {
			t.Errorf("parseRetryAfter(%q) = %v, %v; want %v, %v", tt.v, got, ok, tt.want, tt.ok)
		}
	}
}

// sealSecret encrypts like the API does: "v1:" + base64(nonce || AES-256-GCM ciphertext).
func sealSecret(t *testing.T, key []byte, secret string) string {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, gcm.NonceSize())
	rand.Read(nonce)
	return "v1:" + base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(secret), nil))
}

// webhookFixture inserts an organization, an endpoint pointing at url and one
// webhook job. Deleting the organization cascades to all three.
func webhookFixture(t *testing.T, db *pgxpool.Pool, url string) (webhookSender, Job, []byte) {
	t.Helper()
	key := make([]byte, 32)
	rand.Read(key)
	suffix := strconv.FormatInt(time.Now().UnixNano(), 36)
	org := "org_test_delivery_" + suffix

	_, err := db.Exec(t.Context(),
		`INSERT INTO organization (id, name, slug, created_at) VALUES ($1, 'Delivery test', $2, now())`,
		org, "test-delivery-"+suffix)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.Exec(context.Background(), `DELETE FROM organization WHERE id = $1`, org); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})

	var endpointID string
	err = db.QueryRow(t.Context(),
		`INSERT INTO webhook_endpoint (id, organization_id, url, secret, events)
		 VALUES ($1, $2, $3, $4, '{issue.opened}') RETURNING id`,
		"whk_test_"+suffix, org, url, sealSecret(t, key, "whsec_test")).Scan(&endpointID)
	if err != nil {
		t.Fatal(err)
	}

	payload, _ := json.Marshal(webhookPayload{Event: "issue.opened", Body: `{"action":"opened"}`})
	j := Job{Kind: "webhook", EndpointID: &endpointID, Payload: payload}
	err = db.QueryRow(t.Context(),
		`INSERT INTO delivery_job (kind, idempotency_key, payload, endpoint_id)
		 VALUES ('webhook', $1 || gen_random_uuid()::text, $2, $3) RETURNING id`,
		testKeyPrefix, payload, endpointID).Scan(&j.ID)
	if err != nil {
		t.Fatal(err)
	}
	return webhookSender{db: db, client: newWebhookClient(true), key: key}, j, []byte("whsec_test")
}

func TestWebhookSendSignsAndRecordsTheAttempt(t *testing.T) {
	db := testDB(t)
	type received struct {
		header http.Header
		body   []byte
	}
	reqs := make(chan received, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		reqs <- received{r.Header, body}
		w.Write([]byte("thanks"))
	}))
	defer srv.Close()
	s, j, secret := webhookFixture(t, db, srv.URL)

	if err := s.send(t.Context(), j); err != nil {
		t.Fatal(err)
	}
	r := <-reqs
	gotBody := r.body
	got := struct{ Header http.Header }{r.header}

	if string(gotBody) != `{"action":"opened"}` {
		t.Errorf("body = %s", gotBody)
	}
	ts := got.Header.Get("X-Ghost-Timestamp")
	if want := "sha256=" + hmacHex(secret, []byte(ts+"."), gotBody); got.Header.Get("X-Ghost-Signature-256") != want {
		t.Error("signature does not verify with the endpoint secret")
	}
	if got.Header.Get("X-Ghost-Delivery") != j.ID {
		t.Errorf("X-Ghost-Delivery = %s, want job id %s", got.Header.Get("X-Ghost-Delivery"), j.ID)
	}

	var (
		status int
		body   string
	)
	err := db.QueryRow(t.Context(),
		`SELECT status_code, response_body FROM delivery_attempt WHERE job_id = $1`, j.ID).Scan(&status, &body)
	if err != nil {
		t.Fatal(err)
	}
	if status != 200 || body != "thanks" {
		t.Errorf("attempt = %d %q, want 200 thanks", status, body)
	}
}

func TestWebhookResponseClassification(t *testing.T) {
	db := testDB(t)
	tests := []struct {
		name   string
		status int
		header map[string]string
		check  func(t *testing.T, err error, endpointActive bool)
	}{
		{"500 retries", 500, nil, func(t *testing.T, err error, active bool) {
			var p permanentError
			if err == nil || errors.As(err, &p) {
				t.Errorf("err = %v, want a retryable error", err)
			}
		}},
		{"410 disables the endpoint", 410, nil, func(t *testing.T, err error, active bool) {
			var p permanentError
			if !errors.As(err, &p) {
				t.Errorf("err = %v, want permanentError", err)
			}
			if active {
				t.Error("endpoint still active after 410")
			}
		}},
		{"429 honors Retry-After", 429, map[string]string{"Retry-After": "120"}, func(t *testing.T, err error, active bool) {
			var r retryAfterError
			if !errors.As(err, &r) || r.after != 2*time.Minute {
				t.Errorf("err = %v, want retryAfterError of 2m", err)
			}
		}},
		{"redirect is not followed", 302, map[string]string{"Location": "http://169.254.169.254/"}, func(t *testing.T, err error, active bool) {
			if err == nil || err.Error() != "endpoint responded 302" {
				t.Errorf("err = %v, want endpoint responded 302", err)
			}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				for k, v := range tt.header {
					w.Header().Set(k, v)
				}
				w.WriteHeader(tt.status)
			}))
			defer srv.Close()
			s, j, _ := webhookFixture(t, db, srv.URL)

			err := s.send(t.Context(), j)

			var active bool
			if err := db.QueryRow(t.Context(), `SELECT active FROM webhook_endpoint WHERE id = $1`, *j.EndpointID).Scan(&active); err != nil {
				t.Fatal(err)
			}
			tt.check(t, err, active)
		})
	}
}

func TestWebhookSendDropsJobForDisabledEndpoint(t *testing.T) {
	db := testDB(t)
	hits := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits <- struct{}{} }))
	defer srv.Close()
	s, j, _ := webhookFixture(t, db, srv.URL)
	if _, err := db.Exec(t.Context(), `UPDATE webhook_endpoint SET active = false WHERE id = $1`, *j.EndpointID); err != nil {
		t.Fatal(err)
	}

	var p permanentError
	if err := s.send(t.Context(), j); !errors.As(err, &p) {
		t.Errorf("err = %v, want permanentError", err)
	}
	if len(hits) > 0 {
		t.Error("sent to a disabled endpoint")
	}
}

// Sealed by sealWebhookSecret in apps/api/src/lib/webhooks/webhooks.ts with a
// key of 32 bytes of 7. If this breaks, the API and delivery disagree on the format.
func TestOpenSecretSealedByTheAPI(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	got, err := openSecret(key, "v1:imP+jJazaD8GgSnv6BdCuGKPLoZM2DO5Psxx9jR7ursCPfH6JAzhj4jGDlPn0w==")
	if err != nil || string(got) != "whsec_from_the_api" {
		t.Fatalf("openSecret = %q, %v", got, err)
	}
}
