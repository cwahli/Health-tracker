const fs = require('fs');
const dir = 'src/components/';

function processDir(dirPath) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = dirPath + '/' + file;
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let changed = false;
      // Replace various risky slices
      if (content.includes('suggestions.slice')) {
         content = content.replace(/suggestions\.slice/g, '(suggestions || []).slice');
         changed = true;
      }
      if (content.includes('data.images.slice')) {
         content = content.replace(/data\.images\.slice/g, '(data.images || []).slice');
         changed = true;
      }
      if (content.includes('job.messages?.slice()')) {
         content = content.replace(/job\.messages\?\.slice\(\)/g, '(job.messages || []).slice()');
         changed = true;
      }
      if (content.includes('activeJobs.slice')) {
         content = content.replace(/activeJobs\.slice/g, '(activeJobs || []).slice');
         changed = true;
      }
      if (changed) {
        fs.writeFileSync(fullPath, content);
      }
    }
  }
}

processDir(dir);
