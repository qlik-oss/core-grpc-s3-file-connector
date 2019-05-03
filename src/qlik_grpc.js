const grpc = require('grpc');
const grpcProtoLoader = require('@grpc/proto-loader');

const PROTO_PATH = `${__dirname}/connector.proto`;

const packageDef = grpcProtoLoader.loadSync(PROTO_PATH, { longsAsStrings: false });
const packageObject = grpc.loadPackageDefinition(packageDef);

module.exports = packageObject.qlik.filehosting;
