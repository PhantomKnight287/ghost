package main

import (
	"cmp"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	databaseURL := os.Getenv("DATABASE_URL")
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if databaseURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}
	workers := envInt("WORKERS", 32)
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("unable to connect to database: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("unable to connect to database: %v", err)
	}

	if _, err := pool.Exec(ctx, "select 1 from delivery_job limit 0"); err != nil {
		log.Fatalf("delivery_job not found, run the migrations first: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	srv := &http.Server{Addr: ":" + port, Handler: mux}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server: %v", err)
		}
	}()
	log.Printf("listening on :%s", port)

	wake := make(chan struct{}, 1)
	go listen(ctx, pool, wake)
	go pruneEvery(ctx, pool, pruneInterval)
	email := relaySender{
		url:    os.Getenv("EMAIL_PROXY"),
		secret: os.Getenv("EMAIL_PROXY_SECRET"),
		from:   cmp.Or(os.Getenv("EMAIL_SENDER"), "Ghost <noreply@ghost.local>"),
		client: &http.Client{},
	}
	if email.url == "" {
		log.Printf("EMAIL_PROXY is not set: email jobs will fail and retry until it is")
	}
	var key []byte
	if v := os.Getenv("WEBHOOK_SECRET_KEY"); v != "" {
		key, err = base64.StdEncoding.DecodeString(v)
		if err != nil || len(key) != 32 {
			log.Fatal("WEBHOOK_SECRET_KEY must be 32 bytes, base64-encoded")
		}
	} else {
		log.Printf("WEBHOOK_SECRET_KEY is not set: webhook jobs will fail and retry until it is")
	}
	hostConcurrency := envInt("WEBHOOK_HOST_CONCURRENCY", 4)
	webhook := webhookSender{
		db:     pool,
		client: newWebhookClient(os.Getenv("WEBHOOK_ALLOW_PRIVATE_NETWORKS") == "true"),
		key:    key,
		hosts:  newHostLimiter(hostConcurrency),
	}
	send := func(ctx context.Context, j Job) error {
		switch j.Kind {
		case "email":
			return email.send(ctx, j)
		case "webhook":
			return webhook.send(ctx, j)
		}
		return fmt.Errorf("no sender for job kind %q", j.Kind)
	}
	run(ctx, pool, workers, wake, send) // returns after SIGTERM once in-flight sends drain

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("http shutdown: %v", err)
	}
}

// envInt reads a positive integer setting, or returns def when it is unset.
func envInt(name string, def int) int {
	v := os.Getenv(name)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		log.Fatalf("%s must be a positive integer, got %q", name, v)
	}
	return n
}
