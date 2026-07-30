#!/bin/bash
if [ "$2" = "1" ]; then
    rm -r ./data/"$1".db 2> /dev/null
fi
# rm -r ./data/*.json 2> /dev/null

DBNAME="$1" node src/index.js

