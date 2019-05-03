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
    callback(null, outputChunk);
  }

  _flush(callback) {
    const outputChunk = {
      chunk: {
        data: [],
        last: true,
      },
    };
    callback(null, outputChunk);
  }
}


class GrpcChunkToBufferTransformer extends stream.Transform {
  constructor() {
    super({ objectMode: true, writableObjectMode: true, readableObjectMode: false });
  }

  _transform(chunk, encoding, callback) {
    callback(null, chunk.data);
  }
}

module.exports = {
  BufferToGrpcChunkTransformer,
  GrpcChunkToBufferTransformer,
};
