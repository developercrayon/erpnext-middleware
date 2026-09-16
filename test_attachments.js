const axios = require('axios');

async function test() {
  const baseUrl = 'https://woodwolf.t3elements.com';
  const authHeaders = {
    'Authorization': 'token 8bbb46d32ae70f1:9d7f375b7aa08fa',
    'Accept': 'application/json'
  };
  const itemCode = 'B0H5Q748SW';

  const filesResponse = await axios.get(`${baseUrl}/api/resource/File`, {
    headers: authHeaders,
    params: {
      fields: JSON.stringify(['name', 'file_url', 'file_name', 'is_private', 'creation', 'modified', 'custom_sequence']),
      filters: JSON.stringify([
        ['attached_to_doctype', '=', 'Item'],
        ['attached_to_name', '=', itemCode],
        ['is_folder', '=', 0]
      ]),
      limit_page_length: 1000
    }
  });
  const files = filesResponse.data?.data || [];
  console.log(`Files count: ${files.length}`);

  const logsResponse = await axios.get(`${baseUrl}/api/resource/Comment`, {
    headers: authHeaders,
    params: {
      fields: JSON.stringify(['name', 'creation', 'modified', 'content', 'owner', 'comment_type']),
      filters: JSON.stringify([
        ['reference_doctype', '=', 'Item'],
        ['reference_name', '=', itemCode],
        ['comment_type', 'in', ['Attachment', 'Attachment Removed']]
      ]),
      order_by: 'modified desc',
      limit_page_length: 1000
    }
  });
  const logs = logsResponse.data?.data || [];
  console.log(`Logs count: ${logs.length}`);

  const extractFilename = (content) => {
    if (!content) return null;
    content = content.trim();
    if (content.includes('<a ')) {
      const start = content.indexOf('>') + 1;
      const end = content.indexOf('</a>');
      if (start > 0 && end > start) {
        const filename = content.substring(start, end).trim();
        if (filename) return filename;
      }
    }
    return content;
  };

  const filesByFilename = {};
  for (const file of files) {
    const filename = file.file_name;
    if (!filename) continue; // Note: if file_name is missing, it's skipped here
    if (!filesByFilename[filename]) filesByFilename[filename] = [];
    filesByFilename[filename].push(file);
  }
  console.log(`Files by filename keys:`, Object.keys(filesByFilename));
  console.log(`Some files have missing file_name?`, files.filter(f => !f.file_name).map(f => f.file_url));

  const latestEventByFilename = {};
  for (const log of logs) {
    const filename = extractFilename(log.content);
    if (filename && !latestEventByFilename[filename]) {
      latestEventByFilename[filename] = log;
    }
  }

  // PYTHON SCRIPT REPRO (to show oldest vs newest logic)
  const pythonEventByFilename = {};
  for (const log of logs) {
    const filename = extractFilename(log.content);
    if (filename) pythonEventByFilename[filename] = log; // Python overrides, keeping oldest!
  }

  console.log(`\nComparison of event resolution:`);
  for (const key of Object.keys(filesByFilename)) {
    const mine = latestEventByFilename[key]?.comment_type;
    const python = pythonEventByFilename[key]?.comment_type;
    if (mine !== python) {
      console.log(`Difference for ${key}: TS (newest) = ${mine}, Python (oldest) = ${python}`);
    }
  }

  const activeAttachments = [];
  const usedFileNames = new Set();
  
  // Use Python's buggy oldest-event logic to see if it gives 12
  for (const [filename, event] of Object.entries(pythonEventByFilename)) {
    if (event.comment_type === 'Attachment Removed') continue;
    if (event.comment_type !== 'Attachment') continue;

    const matchingFiles = filesByFilename[filename] || [];
    if (matchingFiles.length === 0) continue;
    activeAttachments.push(filename);
  }

  console.log(`Active attachments count (Python logic): ${activeAttachments.length}`);

  // Use TS newest-event logic
  const activeAttachmentsTS = [];
  for (const [filename, event] of Object.entries(latestEventByFilename)) {
    if (event.comment_type === 'Attachment Removed') continue;
    if (event.comment_type !== 'Attachment') continue;

    const matchingFiles = filesByFilename[filename] || [];
    if (matchingFiles.length === 0) continue;
    activeAttachmentsTS.push(filename);
  }
  console.log(`Active attachments count (TS logic): ${activeAttachmentsTS.length}`);

  const fallbackFiles = [];
  for (const [filename, matchingFiles] of Object.entries(filesByFilename)) {
    if (activeAttachments.includes(filename)) continue;
    const event = pythonEventByFilename[filename];
    if (event && event.comment_type === 'Attachment Removed') continue;
    fallbackFiles.push(filename);
  }

  console.log(`Fallback files count (Python logic): ${fallbackFiles.length}`);

  const fallbackFilesTS = [];
  for (const [filename, matchingFiles] of Object.entries(filesByFilename)) {
    if (activeAttachmentsTS.includes(filename)) continue;
    const event = latestEventByFilename[filename];
    if (event && event.comment_type === 'Attachment Removed') continue;
    fallbackFilesTS.push(filename);
  }

  console.log(`Fallback files count (TS logic): ${fallbackFilesTS.length}`);

  const totalPython = activeAttachments.length + fallbackFiles.length;
  const totalTS = activeAttachmentsTS.length + fallbackFilesTS.length;
  console.log(`\nTotal Final Images (Python): ${totalPython}`);
  console.log(`Total Final Images (TS): ${totalTS}`);

}

test().catch(console.error);
