# Example GRPC S3 File Connector

[![CircleCI](https://circleci.com/gh/qlik-oss/core-grpc-s3-file-connector.svg?style=svg)](https://circleci.com/gh/qlik-oss/core-grpc-s3-file-connector)

*As of 1 July 2020, Qlik Core is no longer available to new customers. No further maintenance will be done in this repository.*

The Example GRPC S3 File Connector shows how to load data into Qlik Associative Engine from S3 using a
dockerized connector built in Javascript. It streams the data using NodeJS streams from the S3 SDK via a simple transform to the grpc output stream.

The `/example` directory defines a simple stack of services using docker-compose:
* Qlik Associative Engine
* S3 GRPC Connector
* Node Test Runner (only used for automated testing)

## Steps to run the example

This example will show how to create a grpc file connector to retrieve the data (originally defined in [example/airports.csv](example/airports.csv))
using either corectl or node.

Run in a \*nix environment (or Git Bash if on Windows), note that you must accept the
[Qlik Core EULA](https://core.qlik.com/eula/) by setting the `ACCEPT_EULA` environment variable.

The connector reads S3 credentials from the following environment variables:
* CORE_S3_FILE_CONNECTOR_BUCKET_NAME_
* CORE_S3_FILE_CONNECTOR_BUCKET_ACCESS_KEY_ID
* CORE_S3_FILE_CONNECTOR_BUCKET_SECRET_ACCESS_KEY
* CORE_S3_FILE_CONNECTOR_BUCKET_REGION

as can be seen in [example/docker-compose.yml](example/docker-compose.yml).


To setup the docker containers simply
```bash
$ cd example
$ ACCEPT_EULA=yes docker-compose up -d --build
```
and then follow either the corectl or node instructions below to build an example app.
Both examples use the loadscript [example/script.qvs](example/script.qvs) to load the data.

### Corectl

If you do not yet have corectl installed just follow the download instructions from [corectl](https://github.com/qlik-oss/corectl).

Once installed, try:

```bash
$ cd corectl
$ corectl build
$ corectl get tables
```
The `build` command then builds the a qlik app using the information in [example/corectl/corectl.yml](example/corectl/corectl.yml)
specifying for example the grpc connection. This command will build the app and load the data from your s3 bucket.

The `get tables` command prints an overview of the tables present in the app.

### Node

To run the example using node.js do:

```bash
$ cd node
$ npm install
$ npm start
```

This will run the script [example/node/index.js](example/node/index.js) to create an app, populate it with data from the s3 bucket and print the resulting table contents.

## Contributing

We welcome and encourage contributions! Please read [Open Source at Qlik R&D](https://github.com/qlik-oss/open-source) for more info on how to get involved.
