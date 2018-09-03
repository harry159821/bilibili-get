var fs = require('mz/fs');
var tmp = require('tmp-promise');
var path = require('path');
var subprocess = require('child_process');
var debug = require('debug').debug('bilibili:i:merger');

function systemSync(cmd) {
  try {
    subprocess.execSync(cmd).toString();
    return 0;
  } 
  catch (error) {
    return error.status;
  }
};

var mergeSegmentFiles = function* (segmentFiles, outputPath, { dryRun }) {
  debug('merging segment files:\n    ' + segmentFiles.join('\n    '));

  var tmpFile = yield tmp.file();

  yield fs.write(tmpFile.fd, segmentFiles.map((a) => `file '${a}'`).join('\n'));

  var ffmpegOptions = [
      '-loglevel quiet',
      '-f concat',
      '-safe 0',
      `-i "${tmpFile.path}"`,
      '-c copy'
    ]
    , mergeCommand = `ffmpeg ${ffmpegOptions.join(' ')} "${path.resolve(outputPath)}"`;

  debug(`executing merge command:\n${mergeCommand}`);

  if (dryRun) {
    return;
  }

  // var { status } = subprocess.spawnSync('sh', ['-c', mergeCommand], {
  //   stdio: 'inherit'
  // });

  var status = systemSync(mergeCommand);

  if (status) {
    if (yield fs.exists(outputPath)) {
      debug('cleanup partial output.');
      yield fs.rm(outputPath);
    }
    throw new Error(`ffmpeg command failed with code ${status}.`);
  } else {
    debug('cleanup segment files...');
    yield segmentFiles.map((f) => fs.unlink(f));
    debug('merging segment files: success.');
  }

};

module.exports = { mergeSegmentFiles };
