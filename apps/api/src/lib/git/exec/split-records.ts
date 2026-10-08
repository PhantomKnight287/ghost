/** Splits a stream of text into the non-empty records between `separator`s, holding a record cut across chunks until it completes. */
export async function* splitRecords(
  chunks: AsyncIterable<string>,
  separator: string,
) {
  let carry = '';

  for await (const chunk of chunks) {
    carry += chunk;
    const records = carry.split(separator);
    carry = records.pop() ?? '';
    for (const record of records) if (record) yield record;
  }

  if (carry) yield carry;
}
