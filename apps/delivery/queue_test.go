package main

import (
	"testing"
	"time"
)

func TestBackoff(t *testing.T) {
	maxRand := func(n int64) int64 { return n - 1 } // always picks the ceiling

	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{0, 10 * time.Second},
		{1, 20 * time.Second},
		{2, 40 * time.Second},
		{3, 80 * time.Second},
		{8, 2560 * time.Second},
		{9, time.Hour}, // 5120s, capped
		{30, time.Hour},
		{100, time.Hour},
	}
	for _, tt := range tests {
		got := backoff(tt.attempt, maxRand)
		if got != tt.want {
			t.Errorf("backoff(%d) = %v, want %v", tt.attempt, got, tt.want)
		}
	}
}
