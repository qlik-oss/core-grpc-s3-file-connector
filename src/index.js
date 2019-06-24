const grpc = require('grpc');
const AWS = require('aws-sdk');
const qlik = require('./qlik_grpc');

const transformer = require('./transformers');

let s3;
let server;

function buildRangeHeader({ start, length }) {
  if (start >= 0 && length > 0) {
    const lastByte = start.toNumber() + length.toNumber();
    const header = `bytes=${start}-${lastByte}`;
    console.log(header);
    return header;
  }
  console.log('No start or end defined for header');
  return null;
}

class S3GrpcFileConnector {
  getCapabilities(call, callback) {
    console.log('get capabilities');
    callback({
      supportsRandomRead: true,
    });
  }

  async download(call) {
    const bufferToChunkTransformer = new transformer.BufferToGrpcChunkTransformer();
    let fileInfo;
    let metadataPromise;
    call.on('data', async (downloadRequest) => {
      if (downloadRequest.file) { // Request for a file
        console.log('download file', downloadRequest.file);
        fileInfo = downloadRequest.file;
        const params = {
          Bucket: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_NAME,
          Key: fileInfo.name,
          Range: 'bytes=0-0',
        };
        metadataPromise = s3.getObject(params).promise();
        try {
          await metadataPromise;
          call.write({
            response: {},
          });
        } catch (err) {
          call.emit('error', {
            code: grpc.status.INVALID_ARGUMENT,
            message: err.message,
          });
          call.end();
        }
      }
      if (downloadRequest.chunk) { // Request for a specific byte range within a previously defined file
        console.log('download chunk', downloadRequest.chunk);
        try {
          const metadata = await metadataPromise;
          const params = {
            Bucket: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_NAME,
            Key: fileInfo.name,
            VersionId: metadata.VersionId,
            Range: buildRangeHeader(downloadRequest.chunk),
          };
          const readStream = s3.getObject(params).createReadStream();
          bufferToChunkTransformer.pipe(call);
          readStream.pipe(bufferToChunkTransformer);
        } catch (err) {
          call.emit('error', {
            code: grpc.status.INVALID_ARGUMENT,
            message: err.message,
          });
          call.end();
        }
      }
    });
  }

  upload(call, callback) {
    const grpcChunkToBytestreamTransformer = new transformer.GrpcChunkToBufferTransformer();
    call.on('data', async (uploadRequest) => {
      if (uploadRequest.file) { // Request for a file
        console.log('upload file', uploadRequest.file);
        const params = {
          Bucket: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_NAME,
          Key: uploadRequest.file.name,
          Body: grpcChunkToBytestreamTransformer,
        };
        const options = {
          partSize: 10 * 1024 * 1024,
          queueSize: 100,
        };
        s3.upload(params, options, (err) => {
          if (err) {
            console.log('upload error', err);
            callback({
              code: grpc.status.INVALID_ARGUMENT,
              message: err.message,
            });
          } else {
            callback(null, { });
          }
        });
      } else if (uploadRequest.chunk) {
        console.log('upload chunk', uploadRequest.chunk.data.length);
        grpcChunkToBytestreamTransformer.write(uploadRequest.chunk);
      }
    });

    call.on('end', async () => {
      console.log('upload on end received');
      grpcChunkToBytestreamTransformer.end();
    });

    call.on('close', async (err) => {
      console.log('upload on close recevied', err);
    });
  }

  async list(call) {
    console.log('list', call.request);
    async function fetchAndSendChunkOfKeys(params) {
      const response = await s3.listObjectsV2(params).promise();
      response.Contents.forEach((awsItem) => {
        const resp = {
          name: awsItem.Key,
          isFolder: false,
          meta: {
            size: awsItem.Size,
            lastUpdated: awsItem.LastModified.getTime() / 1000,
          },
        };
        console.log('list response', resp);
        call.write(resp);
      });
      if (response.IsTruncated) { // If there are more than 1000 items.
        const newParams = { ContinuationToken: response.NextContinuationToken, ...params };
        await fetchAndSendChunkOfKeys(newParams); // Recursive
      }
    }

    try {
      const listParams = {
        Bucket: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_NAME,
        Prefix: call.request.pathPattern,
        Delimiter: '/'
      };
      await fetchAndSendChunkOfKeys(listParams);
    } catch (err) {
      console.log('list error', err);
      call.emit('error', {
        code: grpc.status.INVALID_ARGUMENT,
        message: err.message,
      });
    }
    console.log('list ended');
    call.end();
  }

  async metadata(call, callback) {
    console.log('metadata', call.request);
    try {
      const params = {
        Bucket: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_NAME,
        Prefix: call.request.fileName,
      };
      const responses = await s3.listObjectsV2(params).promise();
      if (responses.length > 0) {
        console.log('metadata response', responses);
        callback(null, {
          size: responses[0].Size,
          lastUpdated: responses[0].LastModified.getTime() / 1000,
        });
      }
      console.log('metadata response', responses);
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: 'No object matching supplied path',
      });
    } catch (err) {
      console.log('metadata response', err);
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: err.message,
      });
    }
  }
}

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Process exiting on SIGTERM');
    process.exit(0);
  });
});

function main() {
  console.log('Starting...');
  // configuring the AWS environment
  AWS.config.update({
    accessKeyId: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_ACCESS_KEY_ID,
    secretAccessKey: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_SECRET_ACCESS_KEY,
  });

  server = new grpc.Server();
  const s3GrpcFileConnector = new S3GrpcFileConnector();
  server.addService(qlik.HostedDrive.service, s3GrpcFileConnector);
  server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
  server.start();
  console.log('Server started on 50051');

  s3 = new AWS.S3();
}

main();
