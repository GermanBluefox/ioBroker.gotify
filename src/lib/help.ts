/**
 * The answer of the command `help`: what the instance answers, written for AI agents (e.g. ioBroker.pi-agent, or the
 * MCP server with `send_to`) and script authors. Keep it in sync with onMessage() in main.ts and the README.
 */

/**
 * The commands onMessage() answers; write = the command has an effect (sends a message);
 * standard = the command of the shared catalog of ioBroker.assistant (HELP.md) it follows
 */
export const COMMANDS: { command: string; write: boolean; standard?: string }[] = [
    { command: 'help', write: false },
    { command: 'send', write: true, standard: 'message.send' },
    { command: 'sendNotification', write: true },
];

export const HELP = `ioBroker.gotify: sends push notifications to a Gotify server; every client (app, browser) of the
Gotify user who owns the application gets them. An agent can send a message with title and priority; it cannot
receive messages. send with text follows the shared catalog of message commands (message.send).

Commands (sendTo gotify.0):
- send {message, title?, priority?, contentType?, token?}: sends a push notification. message: the text (required).
  title: default the name of the application in Gotify. priority: 0 to 10, default the default priority of the
  application; in the Android app 0 = no notification, 1-3 = silent, 4-7 = with sound, 8-10 = also vibration.
  contentType: "text/plain" (default) or "text/markdown". token: the token of another Gotify application instead of
  the one of the settings. Answer {sent: true | false}; on false info.lastError holds the reason.
- send {text, title?, priority?, contentType?, token?} (message.send of the shared catalog, text instead of
  message): the same, priority also true = urgent (8). Gotify has no recipients and no files: recipient, file or
  files are refused with reason NOT_SUPPORTED. Answer {ok: true, sent: 1} or {error, reason?} (reason BAD_REQUEST:
  no text, NOT_CONFIGURED: no URL or token in the settings, NOT_ALLOWED: token refused, NOT_CONNECTED, TIMEOUT).
- sendNotification: for the notification-manager, not for agents.

States (gotify.0.*): info.lastError (reason of the last failure, e.g. "HTTP 401" = wrong token, "ECONNREFUSED"),
info.lastSuccess (time of the last sent message), info.connection.

How to talk to the user:
- Without token the message goes to the Gotify application of the settings, usually the user's own. A token of
  another application (possibly of other people) only on the user's explicit request; ask for it if the recipient
  is not clear.
- Use priority 8 or more only for urgent messages.
- Tell the user whether the message was sent; on {sent: false} read info.lastError and say why.`;
