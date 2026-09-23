const https = require('https');
const fs = require('fs');
https.get('https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/debug/job_1788536445881_7wsmzqg7r.json', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    fs.writeFileSync('debug.json', data);
    console.log('Downloaded debug.json');
  });
}).on('error', (err) => {
  console.error(err);
});
