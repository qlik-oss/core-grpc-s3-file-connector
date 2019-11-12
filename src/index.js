const grpc = require('grpc');
const AWS = require('aws-sdk');
const qlik = require('./qlik_grpc');

const transformer = require('./transformers');

let requestCounter = 0;
let s3;
let server;

function buildRangeHeader({ start, length }) {
  if (start >= 0 && length > 0) {
    const lastByte = start.toNumber() + length.toNumber();
    const header = `bytes=${start}-${lastByte}`;
    console.log(header);
    return header;
  } if (length > 0) {
    const lastByte = length.toNumber();
    const header = `bytes=0-${lastByte}`;
    console.log(header);
    return header;
  }
  console.log('No start or end defined for header');
  return null;
}

class S3GrpcFileConnector {
  getCapabilities(call, callback) {
    console.log('get capabilities');
    callback(null, {
      supportsRandomRead: true,
    });
  }

  async download(call) {
    requestCounter += 1;
    const requestId = requestCounter;
    console.log(requestId, 'download');
    const bufferToChunkTransformer = new transformer.BufferToGrpcChunkTransformer();
    let fileInfo;
    let metadataPromise;
    call.on('data', async (downloadRequest) => {
      console.log(requestId, 'download - on data: ', downloadRequest);
      if (downloadRequest.file) { // Request for a file
        fileInfo = downloadRequest.file;
        const params = {
          Bucket: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_NAME,
          Key: fileInfo.name,
          Range: 'bytes=0-0',
        };
        console.log(requestId, 's3.getObject: ', params);
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
        try {
          const metadata = await metadataPromise;
          console.log(requestId, 'metadata: ', metadata);
          const params = {
            Bucket: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_NAME,
            Key: fileInfo.name,
            VersionId: metadata.VersionId,
            Range: buildRangeHeader(downloadRequest.chunk),
          };
          console.log(requestId, 's3.getObject(params).createReadStream: ', params);
          const readStream = s3.getObject(params).createReadStream();
          readStream.on('error', (error) => {
            console.log(requestId, 'S3 error', error);
            call.write({
              chunk: {
                data: [],
                last: true,
              },
            });
          });
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
    requestCounter += 1;
    const requestId = requestCounter;
    console.log(requestId, 'upload', call.request);
    const grpcChunkToBytestreamTransformer = new transformer.GrpcChunkToBufferTransformer();
    call.on('data', async (uploadRequest) => {
      console.log(requestId, 'upload - on data', uploadRequest);
      if (uploadRequest.file) { // Request for a file
        console.log(requestId, 'upload file', uploadRequest.file);
        const params = {
          Bucket: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_NAME,
          Key: uploadRequest.file.name,
          Body: grpcChunkToBytestreamTransformer,
        };
        const options = {
          partSize: 10 * 1024 * 1024,
          queueSize: 100,
        };
        console.log(requestId, 'upload - s3.upload', params.Bucket, s3.Key, options);
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
        console.log(requestId, 'upload - write chunk length:', uploadRequest.chunk.data.length);
        grpcChunkToBytestreamTransformer.write(uploadRequest.chunk);
      }
    });

    call.on('end', async () => {
      console.log(requestId, 'upload on end received');
      grpcChunkToBytestreamTransformer.end();
    });

    call.on('close', async (err) => {
      console.log(requestId, 'upload on close recevied', err);
    });
  }

  async list(call) {
    requestCounter += 1;
    const requestId = requestCounter;
    console.log(requestId, 'list', call.request);
    async function fetchAndSendChunkOfKeys(params) {
      console.log(requestId, 'list - listObjectsV2', params);
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
        console.log(requestId, 'list - response item', resp);
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
        Delimiter: '/',
      };
      await fetchAndSendChunkOfKeys(listParams);
    } catch (err) {
      console.log(requestId, 'list error', err);
      call.emit('error', {
        code: grpc.status.INVALID_ARGUMENT,
        message: err.message,
      });
    }
    console.log(requestId, 'list ended');
    call.end();
  }

  async metadata(call, callback) {
    requestCounter += 1;
    const requestId = requestCounter;
    console.log(requestId, 'list', call.request);
    try {
      const params = {
        Bucket: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_NAME,
        Prefix: call.request.fileName,
      };
      console.log(requestId, 'list - listObjectsV2', params);
      const responses = await s3.listObjectsV2(params).promise();
      console.log(requestId, 'list - listObjectsV2 response', responses);
      if (responses.Contents.length > 0) {
        const result = {
          size: responses.Contents[0].Size,
          lastUpdated: responses.Contents[0].LastModified.getTime() / 1000,
        };
        console.log(requestId, 'list - response', result);
        callback(null, result);
      } else {
        console.log(requestId, 'list - error', 'No object matching supplied path');
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'No object matching supplied path',
        });
      }
    } catch (err) {
      console.log(requestId, 'list - error', err);
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: err.message,
      });
    }
  }
}

process.on('SIGTERM', () => {
  server.tryShutdown(() => {
    console.log('Process exiting on SIGTERM');
    process.exit(0);
  });
});

function main() {
  console.log('Starting...');
  // configuring the AWS environment
  // regions can be found here https://docs.aws.amazon.com/general/latest/gr/rande.html
  AWS.config.update({
    accessKeyId: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_ACCESS_KEY_ID,
    secretAccessKey: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_SECRET_ACCESS_KEY,
    region: process.env.CORE_S3_FILE_CONNECTOR_BUCKET_REGION,
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
