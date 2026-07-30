#!/bin/bash

rm -r ./data/*.db 2> /dev/null
rm -r ./data/*.json 2> /dev/null

node test.js

