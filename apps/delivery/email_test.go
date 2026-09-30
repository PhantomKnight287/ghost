package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRelaySenderPostsTheProxyTransportBody(t *testing.T) {
	var got map[string]string
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q", ct)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Error(err)
		}
	}))
	defer relay.Close()

	s := relaySender{url: relay.URL, secret: "s3cret", from: "Ghost <noreply@ghost.local>", client: relay.Client()}
	job := Job{Kind: "email", Payload: json.RawMessage(`{"to":"bob@example.com","subject":"Hi","html":"<p>Hi</p>","text":"Hi"}`)}
	if err := s.send(t.Context(), job); err != nil {
		t.Fatal(err)
	}

	want := map[string]string{
		"to": "bob@example.com", "from": "Ghost <noreply@ghost.local>", "subject": "Hi",
		"htmlBody": "<p>Hi</p>", "textBody": "Hi", "secret": "s3cret",
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

func TestRelaySenderFailsOnErrorStatus(t *testing.T) {
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "relay down", http.StatusBadGateway)
	}))
	defer relay.Close()

	s := relaySender{url: relay.URL, client: relay.Client()}
	err := s.send(t.Context(), Job{Payload: json.RawMessage(`{}`)})
	if err == nil || !strings.Contains(err.Error(), "502") || !strings.Contains(err.Error(), "relay down") {
		t.Errorf("err = %v, want it to name the 502 and the relay's message", err)
	}
}

func TestRelaySenderRefusesWithoutAUsableJob(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		payload string
		want    string
	}{
		{"no relay configured", "", `{}`, "EMAIL_PROXY is not set"},
		{"payload is not an email", "http://relay.invalid", `[]`, "decode email payload"},
		{"relay unreachable", "http://127.0.0.1:1", `{}`, "connect"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := relaySender{url: tt.url, client: &http.Client{}}
			err := s.send(t.Context(), Job{Payload: json.RawMessage(tt.payload)})
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("err = %v, want it to mention %q", err, tt.want)
			}
		})
	}
}
