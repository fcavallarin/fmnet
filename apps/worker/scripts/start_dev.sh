#!/bin/bash

rm .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*
wrangler d1 execute sept --file=migrations/0001_initial.sql
wrangler dev