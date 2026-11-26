#!/bin/sh
# usage: perf/k6/run.sh <label> <port> [VUS] [DURATION]   (API must already be running on <port>)
docker run --rm -i -v "$PWD/perf/k6:/s" -e BASE="http://host.docker.internal:$2" -e VUS="${3:-30}" -e DURATION="${4:-30s}" grafana/k6 run --summary-export=/s/$1.json /s/shop.js
