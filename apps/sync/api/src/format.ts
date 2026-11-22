import { SIDE_NAME, Side } from "./side";


const VERDICT_STATE_MAPPING = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  COMMENTED:"Commented"
} as const

export function mergedText(side: Side) {
  return `Merged on ${SIDE_NAME[side]}`
};


const marker = /^<!-- ghost-sync:from=(ghost|github) author=(\S+) -->\n\*\*@\S+\*\* on (?:Ghost|GitHub):\n\n/;

export function readMarker(body: string) {
  const match = marker.exec(body)
  if (!match) return { body, from: null, author:null }
  return {
    body: body.slice(match[0].length),
    from: match[1],
    author:match[2]
  }
};

export function verdictText(state:keyof typeof VERDICT_STATE_MAPPING, from: Side, author: string) {
  return `${VERDICT_STATE_MAPPING[state]} on ${SIDE_NAME[from]} by @${author}`
};


export function withMarker(body: string, from: Side, author: string) {
  return `<!-- ghost-sync:from=${from} author=${author} -->
**@${author}** on ${SIDE_NAME[from]}:

${body}`
};
