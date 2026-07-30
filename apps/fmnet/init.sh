#!/bin/bash
rm -r data/app.*
rm data/appcl.*;
rm data/appcl1.*;
rm bootstrap.json 2> /dev/null
rm cldev.json 2> /dev/null

node src/cli.js init
# exit 0
echo "Network created"


SQLITE_DB="./data/appcl.db" node src/cli.js initDevice test2
# SQLITE_DB="./data/appcl.db" node src/cli.js exportDevice cldev.json
echo "Client 1 created"

node src/cli.js  addDevice
echo "Client 1 added"
SQLITE_DB="./data/appcl.db" node src/cli.js getPairing
# exit 0

SQLITE_DB="./data/appcl1.db" node src/cli.js initDevice test3
echo "Client 2 created"

node src/cli.js addDevice
echo "Client 2 added"
SQLITE_DB="./data/appcl1.db" node src/cli.js getPairing



# SQLITE_DB="./data/appcl1.db" node src/cli.js initDevice $FID test3 bootstrap.json
# SQLITE_DB="./data/appcl1.db" node src/cli.js exportDevice cldev.json
# echo "Client 2 created"
# # exit 0

# node src/cli.js  addDevice cldev.json;
# echo "Client 2 added"

SQLITE_DB="./data/appcl.db" node src/cli.js  syncDevices || exit 1;
echo "DEvices synced on client 1"
SQLITE_DB="./data/appcl1.db" node src/cli.js  syncDevices || exit 1;
echo "DEvices synced on client 2"



node src/cli.js shareDevice test3 test2|| exit 1
echo "Device shared"
SQLITE_DB="./data/appcl.db" node src/cli.js getEvents || exit 1
echo "Device keys shared client 2 to client 1"



SQLITE_DB="./data/appcl1.db" node src/cli.js getEvents || exit 1
echo "Device keys shared client 1 to client 2"


# exit 0
echo "------OK------"
echo
node src/cli.js sendMessage hello2  test2|| exit 1
echo "Message 1 sent"
SQLITE_DB="./data/appcl.db" node src/cli.js getEvents || exit 1

echo "~~~~~~~~~~~~~~~~~"
SQLITE_DB="./data/appcl.db" node src/cli.js sendMessage venedri test3 || exit 1
echo "Message 2 sent"
SQLITE_DB="./data/appcl1.db" node src/cli.js getEvents || exit 1

# rm bootstrap.json
# rm cldev.json