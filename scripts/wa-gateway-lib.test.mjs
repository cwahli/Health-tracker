import { describe, it, expect } from 'vitest';
import { parseGatewayCode, extractGatewayText, extractGatewayWaId } from './wa-gateway-lib.mjs';

describe('wa-gateway-lib', () => {
  it('parses exactly one code, mirrors server_whatsapp shape', () => {
    expect(parseGatewayCode('LOGIN wa_' + 'a'.repeat(32))).toBe('wa_' + 'a'.repeat(32));
    expect(parseGatewayCode('hi WA_' + 'B'.repeat(32))).toBe('wa_' + 'b'.repeat(32));
    expect(parseGatewayCode('no code here')).toBeNull();
    expect(parseGatewayCode(`wa_${'a'.repeat(32)} wa_${'b'.repeat(32)}`)).toBeNull();
    expect(parseGatewayCode(null)).toBeNull();
  });

  it('extracts plain, extended and caption text; ignores non-text', () => {
    expect(extractGatewayText({ message: { conversation: 'hi' } })).toBe('hi');
    expect(extractGatewayText({ message: { extendedTextMessage: { text: 'LOGIN x' } } })).toBe('LOGIN x');
    expect(extractGatewayText({ message: { imageMessage: { caption: 'cap' } } })).toBe('cap');
    expect(extractGatewayText({ message: { audioMessage: {} } })).toBeNull();
    expect(extractGatewayText({})).toBeNull();
  });

  it('takes identity from direct chats only', () => {
    expect(extractGatewayWaId('447366650028@s.whatsapp.net')).toBe('447366650028');
    expect(extractGatewayWaId('6281337403030@s.whatsapp.net')).toBe('6281337403030');
    expect(extractGatewayWaId('120363025@g.us')).toBeNull();
    expect(extractGatewayWaId('abc@newsletter')).toBeNull();
    expect(extractGatewayWaId('status@broadcast')).toBeNull();
    expect(extractGatewayWaId(undefined)).toBeNull();
  });
});
