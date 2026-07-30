#!/bin/bash

if [ "$1" = "all" ]; then
    cd ../../../packages/client/tests || exit 1
    ./run.sh || exit 1
    cd -
fi

rm -r ./data/*.db 2> /dev/null
rm -r ./data/*.json 2> /dev/null

node test.js


