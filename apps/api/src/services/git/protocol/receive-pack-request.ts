import { OID_LENGTH, type RefTransition } from '../wal/wal.types.js';
import { readHead, type GitRequestBody } from './git-request-body.js';
import { InvalidReceivePackRequestError } from './protocol.errors.js';

const PKT_LENGTH_CHARS = 4;
const FLUSH_PACKET = '0000';
const OID_HEX_LENGTH = OID_LENGTH * 2;
const PACK_SIGNATURE = 'PACK';

/**
 * Git cannot rewind a chunked request to retry it with credentials, so before
 * streaming any push larger than `http.postBuffer` it fires a throwaway POST
 * whose whole body is one flush packet and checks the status. Answering it with
 * an error kills the push before the real body is ever sent.
 */
export async function isProbeRequest(body: GitRequestBody) {
  if (body.size !== PKT_LENGTH_CHARS) return false;
  return (await readHead(body, PKT_LENGTH_CHARS)).toString('ascii') === FLUSH_PACKET;
}

/** A push touching thousands of refs still keeps its command section well inside this. */
const MAX_COMMAND_SECTION_BYTES = 1024 * 1024;

export interface ReceivePackRequest {
  transitions: RefTransition[];
  capabilities: string[];
  pack: Buffer;
}

export interface ReceivePackHeader {
  transitions: RefTransition[];
  capabilities: string[];
  packOffset: number;
  packSize: number;
}

/**
 * Reads only the command section, leaving the packfile on disk. A 2 GiB push
 * cannot be a Buffer — `Hash.update` and most Buffer operations cap at INT_MAX.
 */
export async function readReceivePackHeader(
  body: GitRequestBody,
): Promise<ReceivePackHeader> {
  const head = await readHead(body, MAX_COMMAND_SECTION_BYTES);
  const { transitions, capabilities, packOffset } = parseCommandSection(head);

  return {
    transitions,
    capabilities,
    packOffset,
    packSize: body.size - packOffset,
  };
}

/**
 * Splits a receive-pack body into its command section and packfile.
 *
 *   <pkt-line> "<old-oid> <new-oid> <ref>\0<capabilities>"
 *   <pkt-line> "<old-oid> <new-oid> <ref>"
 *   0000
 *   PACK...
 */
export function parseReceivePackRequest(body: Buffer): ReceivePackRequest {
  const { transitions, capabilities, packOffset } = parseCommandSection(body);
  const pack = body.subarray(packOffset);

  if (pack.length > 0 && pack.toString('ascii', 0, 4) !== PACK_SIGNATURE) {
    throw new InvalidReceivePackRequestError('missing PACK signature', body);
  }

  return { transitions, capabilities, pack };
}

/**
 *   <pkt-line> "<old-oid> <new-oid> <ref>\0<capabilities>"
 *   <pkt-line> "<old-oid> <new-oid> <ref>"
 *   0000
 *   PACK...
 */
function parseCommandSection(body: Buffer) {
  const transitions: RefTransition[] = [];
  let capabilities: string[] = [];
  let offset = 0;

  for (;;) {
    if (offset + PKT_LENGTH_CHARS > body.length) {
      throw new InvalidReceivePackRequestError('truncated command section', body);
    }

    const marker = body.toString('ascii', offset, offset + PKT_LENGTH_CHARS);
    if (marker === FLUSH_PACKET) {
      offset += PKT_LENGTH_CHARS;
      break;
    }

    const length = Number.parseInt(marker, 16);
    if (!Number.isInteger(length) || length < PKT_LENGTH_CHARS) {
      throw new InvalidReceivePackRequestError(`bad pkt-line length ${marker}`, body);
    }
    if (offset + length > body.length) {
      throw new InvalidReceivePackRequestError('pkt-line runs past end of body', body);
    }

    const payload = body.toString('utf8', offset + PKT_LENGTH_CHARS, offset + length);
    offset += length;

    const [command, capabilityList] = payload.split('\0');
    if (capabilityList !== undefined && transitions.length === 0) {
      capabilities = capabilityList.trim().split(' ').filter(Boolean);
    }
    transitions.push(parseCommand(command.replace(/\n$/, '')));
  }

  if (transitions.length === 0) {
    throw new InvalidReceivePackRequestError('no ref update commands', body);
  }

  return { transitions, capabilities, packOffset: offset };
}

function parseCommand(command: string): RefTransition {
  const [oldOid, newOid, ...rest] = command.split(' ');
  const ref = rest.join(' ');

  if (!isOid(oldOid) || !isOid(newOid) || !ref) {
    throw new InvalidReceivePackRequestError(`malformed command "${command}"`);
  }

  return {
    ref,
    oldOid: Buffer.from(oldOid, 'hex'),
    newOid: Buffer.from(newOid, 'hex'),
  };
}

function isOid(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length === OID_HEX_LENGTH &&
    /^[0-9a-f]+$/.test(value)
  );
}
