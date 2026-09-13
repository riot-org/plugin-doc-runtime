// tar ↔ tar.zst。Windows 没有 zstd 命令行，Node 22.15+ 自带。
//
//   node scripts/zstd.mjs <输入> <输出> [等级]
//   node scripts/zstd.mjs -d <输入.zst> <输出>

import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

if (typeof zlib.createZstdCompress !== 'function') {
  console.error(`当前 Node (${process.version}) 不支持 zstd，需要 22.15 以上。`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const decompress = argv[0] === '-d';
const [input, output, level = '19'] = decompress ? argv.slice(1) : argv;
if (!input || !output) {
  console.error('用法: node scripts/zstd.mjs [-d] <输入> <输出> [压缩等级]');
  process.exit(2);
}

if (decompress) {
  await pipeline(
    fs.createReadStream(input),
    zlib.createZstdDecompress(),
    fs.createWriteStream(output),
  );
} else {
  await pipeline(
    fs.createReadStream(input),
    zlib.createZstdCompress({
      params: { [zlib.constants.ZSTD_c_compressionLevel]: Number(level) },
    }),
    fs.createWriteStream(output),
  );
}
