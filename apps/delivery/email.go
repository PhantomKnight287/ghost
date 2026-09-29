package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// emailPayload is what the API puts in delivery_job.payload for kind 'email'.
type emailPayload struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	HTML    string `json:"html"`
	Text    string `json:"text"`
}

// relaySender POSTs email jobs to the HTTP relay, the same request
// apps/api/src/mail/proxy.transport.ts makes. The relay URL is operator
// config, not user input, so it skips the SSRF guard.
type relaySender struct {
	url, secret, from string
	client            *http.Client
}

func (r relaySender) send(ctx context.Context, j Job) error {
	if r.url == "" {
		return fmt.Errorf("EMAIL_PROXY is not set")
	}
	var p emailPayload
	if err := json.Unmarshal(j.Payload, &p); err != nil {
		return fmt.Errorf("decode email payload: %w", err)
	}
	body, err := json.Marshal(map[string]string{
		"to":       p.To,
		"from":     r.from,
		"subject":  p.Subject,
		"htmlBody": p.HTML,
		"textBody": p.Text,
		"secret":   r.secret,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		return fmt.Errorf("email relay responded with %d: %s", res.StatusCode, msg)
	}
	return nil
}
