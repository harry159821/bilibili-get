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

var downloadFiles = async function (taskInfo, { dryRun, print = _.noop, outputDir, downloadOptions = [] }) {

  var segmentFiles = [];
  var downloadProcesses = [];

  for (var i = 0, N = taskInfo.durl.length; i++ != N; segmentFiles[i-1] = (function ({ url, size }) {

    print(`downloading video segment ${i}/${N}...`);

    var fileName = `av${taskInfo.aid}-${i}.${guessFileExtension(url)}`
      , filePath = path.resolve(outputDir, fileName);

    try {
      var stat = fs.statSync(filePath);
      if (stat.size === size && !(fs.existsSync(`${filePath}.aria2`))) {
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
      , downloadCommand = `aria2c ${aria2cOptions.join(' ')} "${url}"`;

    debug(`executing download command:\n${downloadCommand}`);

    var p = new Promise((resolve, reject) => {
        subprocess.exec(downloadCommand, (err, stdout) => {
          if (!err) {
            resolve(filePath);
          } else {
            print(`download command ${downloadCommand} failed with error ${err}.`);
          }
      });
    }).catch((error) => {
      debug('download video segments: failed.');
    });
    downloadProcesses.push(p);

  })(taskInfo.durl[i-1]));

  await Promise.all(downloadProcesses).then(values => { 
    console.log(values);
    segmentFiles = values;
  }, reason => {
    console.log(reason)
  }).catch((error) => {
    debug('download video segments: failed.');
  });

  debug('download video segments: success.');
  check(segmentFiles);

  return segmentFiles;
};

module.exports = { downloadFiles, guessFileExtension };
