/**
 * bot-commands.mjs — re-export shim.
 *
 * Single source of truth lives in `./commands.mjs` (BOT_COMMANDS,
 * COMMAND_NAMES, toTelegramCommands, assertValidCommands). This file exists
 * only so older imports keep working — do not add a second list here.
 */

export { BOT_COMMANDS, COMMAND_NAMES, toTelegramCommands, assertValidCommands } from './commands.mjs';

