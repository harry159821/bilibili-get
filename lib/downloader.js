var fs = require('mz/fs');
var path = require('path');
var debug = require('debug').debug('bilibili:i:downloader');
var check = require('debug').debug('bilibili:d:downloader');
var process = require('process');
var subprocess = require('child_process');
var _ = require('lodash');

var guessFileExtension = function (url) {
  return /https?:\/\/(?:[^/]+\/)+[^.]+(?:\.[^.]+\.)*\.?(.*)(?=\?)/.exec(url)[1];
};

function exec(downloadCommandArray) {
  return new Promise((resolve, reject) => {
    var ret = downloadCommandArray.length;
    print = _.noop;
    for (var i = downloadCommandArray.length - 1; i >= 0; i--) {
      cmd = downloadCommandArray[i];
      subprocess.exec(cmd, (err, stdout) => {
        if (--ret == 0) {
          resolve(42);
        }
        if (!err) {
          print("command done", cmd)
          // resolve(stdout);
        } else {
          print("command failed", cmd)
          // reject(err);
        }
      });
    }
  });
}


var downloadFiles = function* (taskInfo, { dryRun, print = _.noop, outputDir, downloadOptions = [] }) {

  var segmentFiles = [];
  var downloadCommandArray = [];

  print(`downloading video segment ...`);

  for (var i = 0, N = taskInfo.durl.length; i++ != N; segmentFiles[i-1] = yield (function* ({ url, size }) {

    var fileName = `av${taskInfo.aid}-${i}.${guessFileExtension(url)}`
      , filePath = path.resolve(outputDir, fileName);

    try {
      var stat = yield fs.stat(filePath);
      if (stat.size === size && !(yield fs.exists(`${filePath}.aria2`))) {
        debug(`file ${filePath} already downloaded.`);
        return filePath;
      } else {
        debug(`file ${filePath} is incomplete.`);
      }
    } catch (e) {
      debug(`file ${filePath} not exists.`);
    }

    var aria2cOptions = [
        '--no-conf',
        '--console-log-level=error',
        '--file-allocation=none',
        '--summary-interval=0',
        '--download-result=hide',
        '--continue',
        `--dir="${outputDir}"`,
        `--out="${fileName}"`,
        `--referer="${taskInfo.url}"`,
        ...downloadOptions.map((option) => (option.length === 1 || option.indexOf('=') === 1) ? `-${option}` : `--${option}`)
      ]
      , sub_downloadCommand = `aria2c ${aria2cOptions.join(' ')} "${url}"`;

    downloadCommandArray.push(sub_downloadCommand);

    if (dryRun) {
      return filePath;
    }

    return filePath;
  })(taskInfo.durl[i-1]));

  yield exec(downloadCommandArray);

  // var downloadCommand = downloadCommandArray.join("|");
  // debug(`executing download command:\n${downloadCommand}`);

  // var { status } = subprocess.spawnSync('sh', ['-c', downloadCommand], {
  //   stdio: 'inherit'
  // });

  // process.stderr.write('\33[2K\r');

  // if (status) {
  //   throw new Error(`download command failed with code ${status}.`);
  // }

  print('download video segments: success.');
  check(segmentFiles);

  return segmentFiles;
};

module.exports = { downloadFiles, guessFileExtension };
