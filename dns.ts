import { assert } from "https://deno.land/std@0.212.0/assert/assert.ts";

export const TYPE_A = 1;
export const CLASS_IN = 1;

const RECURSION_DESIRED = 1 << 8;

export async function resolve(domainName: string): Promise<string[] | null> {
  const listener = Deno.listenDatagram({
    transport: "udp",
    hostname: "0.0.0.0",
    port: 0,
  });

  await listener.send(buildQuery(domainName), {
    transport: "udp",
    hostname: "8.8.8.8",
    port: 53,
  });

  const [response] = await listener.receive();

  const { answers } = parseDNSPacket(response);

  return answers.map(({ data }) => data.join("."));
}

type DNSPacket = {
  header: DNSHeader;
  questions: DNSQuestion[];
  answers: DNSRecord[];
  authorities: DNSRecord[];
  additionals: DNSRecord[];
};

export function parseDNSPacket(response: Uint8Array): DNSPacket {
  let offset = 0;

  /* Used for storing name between function calls because of comporession */
  const readNameCtx: ReadNameContext = { response };

  const [header, headerLength] = bytesToHeader(response);
  offset += headerLength;

  const questions: DNSQuestion[] = [];
  for (let i = 0; i < header.num_questions; i++) {
    const [question, questionLength] = bytesToQuestion(
      response.slice(offset),
      readNameCtx
    );

    questions.push(question);
    offset += questionLength;
  }

  const answers: DNSRecord[] = [];
  for (let i = 0; i < header.num_answers; i++) {
    const [record, recordLength] = bytesToRecord(
      response.slice(offset),
      readNameCtx
    );

    answers.push(record);
    offset += recordLength;
  }

  const authorities: DNSRecord[] = [];
  for (let i = 0; i < header.num_authorities; i++) {
    const [record, recordLength] = bytesToRecord(
      response.slice(offset),
      readNameCtx
    );

    authorities.push(record);
    offset += recordLength;
  }

  const additionals: DNSRecord[] = [];
  for (let i = 0; i < header.num_additionals; i++) {
    const [record, recordLength] = bytesToRecord(
      response.slice(offset),
      readNameCtx
    );

    additionals.push(record);
    offset += recordLength;
  }

  assert(offset === response.length, "Response is not fully parsed");

  return { header, questions, answers, additionals, authorities };
}

export function buildQuery(
  domainName: string,
  recordType = TYPE_A
): Uint8Array {
  const name = encodeDNSName(domainName);
  const id = randomId();

  const header: DNSHeader = {
    id,
    flags: RECURSION_DESIRED,
    num_questions: 1,
    num_additionals: 0,
    num_answers: 0,
    num_authorities: 0,
  };

  const question = { name, type: recordType, class: CLASS_IN };

  return concatUint8Arrays(headerToBytes(header), questionToBytes(question));
}

export function encodeDNSName(domain: string): Uint8Array {
  const encoder = new TextEncoder();

  const result: Uint8Array[] = [];
  for (const part of domain.split(".")) {
    result.push(numberTo1Byte(part.length), encoder.encode(part));
  }
  result.push(numberTo1Byte(0));

  return result.reduce(concatUint8Arrays);
}

/* DTOs */

type DNSRecord = {
  name: Uint8Array;
  type: number;
  class: number;
  ttl: number;
  data: Uint8Array;
};

function bytesToRecord(
  bytes: Uint8Array,
  readNameCtx: ReadNameContext
): [record: DNSRecord, readBytes: number] {
  const [name, nameLength] = readName(bytes, readNameCtx);

  const FIXED_FIELDS_LENGTH = 2 + 2 + 4 + 2;

  const targetBytes = bytes.slice(nameLength);

  const infoBytes = targetBytes.slice(0, FIXED_FIELDS_LENGTH);

  const [type_, class_] = bytesToNumbers(infoBytes.slice(0, 4), 2);
  const [ttl] = bytesToNumbers(infoBytes.slice(4, 8), 4);
  const [dataLength] = bytesToNumbers(infoBytes.slice(8, 10), 2);

  const data = targetBytes.slice(
    FIXED_FIELDS_LENGTH,
    FIXED_FIELDS_LENGTH + dataLength
  );

  return [
    {
      name,
      class: class_,
      type: type_,
      ttl,
      data,
    },
    nameLength + FIXED_FIELDS_LENGTH + dataLength,
  ];
}

export type DNSHeader = {
  id: number;
  flags: number;
  num_questions: number;
  num_answers: number;
  num_authorities: number;
  num_additionals: number;
};

export function headerToBytes(header: DNSHeader): Uint8Array {
  return [
    header.id,
    header.flags,
    header.num_questions,
    header.num_answers,
    header.num_authorities,
    header.num_additionals,
  ]
    .map(numberTo2Bytes)
    .reduce(concatUint8Arrays);
}

function bytesToHeader(
  bytes: Uint8Array
): [header: DNSHeader, readBytes: number] {
  const HEADER_LENGHT = 12;

  const [
    id,
    flags,
    num_questions,
    num_answers,
    num_authorities,
    num_additionals,
  ] = bytesToNumbers(bytes.slice(0, HEADER_LENGHT), 2);

  return [
    {
      id,
      flags,
      num_questions,
      num_answers,
      num_authorities,
      num_additionals,
    },
    HEADER_LENGHT,
  ];
}

type DNSQuestion = {
  name: Uint8Array;
  type: number;
  class: number;
};

function questionToBytes(question: DNSQuestion): Uint8Array {
  return [
    question.name,
    numberTo2Bytes(question.type),
    numberTo2Bytes(question.class),
  ].reduce(concatUint8Arrays);
}

function bytesToQuestion(
  bytes: Uint8Array,
  readNameCtx: ReadNameContext
): [question: DNSQuestion, questionLength: number] {
  const [name, readBytes] = readName(bytes, readNameCtx);

  const questionLength = readBytes + 4;

  const [type_, class_] = bytesToNumbers(
    bytes.slice(readBytes, questionLength),
    2
  );

  return [
    {
      name,
      type: type_,
      class: class_,
    },
    questionLength,
  ];
}

type ReadNameContext = {
  response: Uint8Array;
};

function readName(
  bytes: Uint8Array,
  readNameCtx: ReadNameContext
): [name: Uint8Array, readBytes: number] {
  /* Handle compression */
  const lengthByte = bytes.at(0);
  const pointerByte = bytes.at(1);

  if (lengthByte && pointerByte && lengthByte & 0b1100_0000) {
    const [pointer] = bytesToNumbers(
      new Uint8Array([lengthByte & 0b0011_1111, pointerByte]),
      2
    );

    const [name] = readName(readNameCtx.response.slice(pointer), readNameCtx);

    return [name, 2];
  }

  /* Handle regular name parsing */
  const parts: Uint8Array[] = [];

  let i = 0;
  while (i < bytes.length) {
    const lengthByte = bytes[i];
    i += 1;

    if (lengthByte > 0) {
      const offset = i + lengthByte;
      const name = bytes.slice(i, offset);
      if (parts.length > 0) {
        parts.push(new Uint8Array([".".charCodeAt(0)]));
      }
      parts.push(name);

      i += lengthByte;
    }

    if (lengthByte === 0) {
      break;
    }
  }

  const nameBytes = parts.reduce(concatUint8Arrays);

  return [nameBytes, i];
}

/* Utils */

function numberTo1Byte(num: number): Uint8Array {
  return numberToBytes(num, 1);
}

function numberTo2Bytes(num: number): Uint8Array {
  return numberToBytes(num, 2);
}

function numberToBytes(num: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let x = num;
  for (let i = size - 1; i >= 0; i--) {
    const rightByte = x & 0xff;
    bytes[i] = rightByte;
    x = Math.floor(x / 0x100);
  }

  return bytes;
}

function bytesToNumbers(bytes: Uint8Array, size: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    const bytesSlice = bytes.slice(i, i + size).toReversed();

    let value = 0;
    for (let i = bytesSlice.length - 1; i >= 0; i--) {
      value = value * 256 + bytesSlice[i];
    }
    values.push(value);
  }

  return values;
}

function concatUint8Arrays(arr1: Uint8Array, arr2: Uint8Array): Uint8Array {
  const tmp = new Uint8Array(arr1.byteLength + arr2.byteLength);
  tmp.set(arr1, 0);
  tmp.set(arr2, arr1.byteLength);
  return tmp;
}

function randomId(): number {
  return Math.floor(Math.random() * 65535);
}

export function toHex(arr: Uint8Array): string {
  return [...arr].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function decodeText(arr: Uint8Array): string {
  return new TextDecoder().decode(arr);
}
