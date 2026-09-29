# syntax=docker/dockerfile:1
# Built from the repository root, like the other services:
#   docker build -f apps/delivery/Dockerfile .

FROM golang:1.25 AS build
WORKDIR /src
# Dependencies first, so a code change doesn't re-download them.
COPY apps/delivery/go.mod apps/delivery/go.sum ./
RUN go mod download
COPY apps/delivery/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /delivery .

# No shell or libc, only CA certificates: the binary is statically linked.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /delivery /delivery
EXPOSE 8080
ENTRYPOINT ["/delivery"]
