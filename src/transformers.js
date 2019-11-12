const stream = require('stream');

class BufferToGrpcChunkTransformer extends stream.Transform {
  constructor() {
    super({ objectMode: true, writableObjectMode: true, readableObjectMode: false });
  }

  _transform(chunk, encoding, callback) {
    const outputChunk = {
      chunk: {
        data: chunk,
        last: false,
      },
    };
    console.log('chunk data', outputChunk.chunk.data.length);
    callback(null, outputChunk);
  }

  _flush(callback) {
    const outputChunk = {
      chunk: {
        data: [],
        last: true,
      },
    };
    console.log('chunk data', outputChunk.chunk.data.length, '(last)');
    callback(null, outputChunk);
  }
}


class GrpcChunkToBufferTransformer extends stream.Transform {
  constructor() {
    super({ objectMode: true, writableObjectMode: true, readableObjectMode: false });
  }

  _transform(chunk, encoding, callback) {
    console.log('chunk data', chunk.data.length);
    callback(null, chunk.data);
  }
}

module.exports = {
  BufferToGrpcChunkTransformer,
  GrpcChunkToBufferTransformer,
};
