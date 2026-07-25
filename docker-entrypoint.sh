#!/bin/sh
set -e

PORT=8321 node irl-books/server.js &

wait
