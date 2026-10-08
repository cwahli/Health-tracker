import { spawn } from 'node:child_process';
import path from 'node:path';

const PYTHON_BIN = '/usr/bin/python3';
const HANDLER_PATH = '/home/ubuntu/tax/bot/agenda_handler.py';

export async function runAgendaHandler(inputQuery) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, [HANDLER_PATH, inputQuery], {
      env: {
        ...process.env,
        PYTHONPATH: '/home/ubuntu/tax/calendar:/home/ubuntu/tax/bot:' + (process.env.PYTHONPATH || ''),
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`[agenda-runner] exited with code ${code}: ${stderr}`);
        return resolve(null);
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (err) {
        console.error(`[agenda-runner] JSON parse error: ${err.message}, raw: ${stdout}`);
        resolve({ text: stdout.trim() });
      }
    });

    child.on('error', (err) => {
      console.error(`[agenda-runner] spawn error: ${err.message}`);
      resolve(null);
    });
  });
}

export async function handleAgendaMessage({ api, chatId, text }) {
  if (!text) return false;
  try {
    const res = await runAgendaHandler(text);
    if (!res || !res.text) return false;

    await api.sendMessage(chatId, res.text, {
      parse_mode: 'HTML',
      reply_markup: res.reply_markup,
      disable_web_page_preview: true,
    });
    return true;
  } catch (err) {
    console.error(`[agenda-runner] error handling message: ${err.message}`);
    return false;
  }
}
