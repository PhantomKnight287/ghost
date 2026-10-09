// this is just a mock implementation
export function encodeNodeId(node: string, id: string) {
  return `U_${Buffer.from(id).toString('base64url')}`
}
