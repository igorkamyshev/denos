import { assertEquals } from "https://deno.land/std@0.212.0/assert/mod.ts";

import {
  headerToBytes,
  encodeDNSName,
  toHex,
  buildQuery,
  TYPE_A,
  parseDNSPacket,
  decodeText,
  CLASS_IN,
} from "./dns.ts";

/* headerToBytes */
Deno.test("headerToBytes from article", () => {
  const result = headerToBytes({
    id: 0x1314,
    flags: 0,
    num_questions: 1,
    num_additionals: 0,
    num_answers: 0,
    num_authorities: 0,
  });

  assertEquals(toHex(result), "131400000001000000000000");
});

/* encodeDNSName */
Deno.test("encodeDNSName from article", () => {
  const result = encodeDNSName("google.com");

  assertEquals(toHex(result), "06676f6f676c6503636f6d00");
});

/* buildQuery */
Deno.test("buildQuery from article", () => {
  const result = buildQuery("www.example.com", TYPE_A);

  assertEquals(
    toHex(result).slice(4) /* skip id */,
    "0100000100000000000003777777076578616d706c6503636f6d0000010001"
  );
});

/* parseDNSPacket */
Deno.test("parseDNSPacket for www.example.com", () => {
  const parsed = parseDNSPacket(
    /* real response for www.example.com */
    new Uint8Array([
      218, 140, 129, 128, 0, 1, 0, 1, 0, 0, 0, 0, 3, 119, 119, 119, 7, 101, 120,
      97, 109, 112, 108, 101, 3, 99, 111, 109, 0, 0, 1, 0, 1, 192, 12, 0, 1, 0,
      1, 0, 0, 21, 216, 0, 4, 93, 184, 216, 34,
    ])
  );

  assertEquals(parsed.header, {
    id: 55948,
    flags: 33152,
    num_questions: 1,
    num_answers: 1,
    num_authorities: 0,
    num_additionals: 0,
  });

  assertEquals(parsed.questions.length, 1);

  const question = parsed.questions.at(0)!;
  assertEquals(decodeText(question.name), "www.example.com");
  assertEquals(question.type, TYPE_A);
  assertEquals(question.class, CLASS_IN);

  assertEquals(parsed.answers.length, 1);

  const answer = parsed.answers.at(0)!;
  assertEquals(decodeText(answer.name), "www.example.com");
  assertEquals(answer.type, TYPE_A);
  assertEquals(answer.class, CLASS_IN);
  /*
   * TODO: Why so weird value?
   */
  assertEquals(answer.ttl, 5592);
  assertEquals(answer.data, new Uint8Array([93, 184, 216, 34]));
});

Deno.test("parseDNSPacket for kamyshev.me", () => {
  const parsed = parseDNSPacket(
    /* real response for kamyshev.me */
    new Uint8Array([
      198, 243, 129, 128, 0, 1, 0, 2, 0, 0, 0, 0, 8, 107, 97, 109, 121, 115,
      104, 101, 118, 2, 109, 101, 0, 0, 1, 0, 1, 192, 12, 0, 1, 0, 1, 0, 0, 1,
      44, 0, 4, 188, 114, 97, 3, 192, 12, 0, 1, 0, 1, 0, 0, 1, 44, 0, 4, 188,
      114, 96, 3,
    ])
  );

  assertEquals(parsed.header, {
    id: 50931,
    flags: 33152,
    num_questions: 1,
    num_answers: 2,
    num_authorities: 0,
    num_additionals: 0,
  });

  assertEquals(parsed.questions.length, 1);

  const question = parsed.questions.at(0)!;
  assertEquals(decodeText(question.name), "kamyshev.me");
  assertEquals(question.type, TYPE_A);
  assertEquals(question.class, CLASS_IN);

  assertEquals(parsed.answers.length, 2);

  const firstAnswer = parsed.answers.at(0)!;
  assertEquals(decodeText(firstAnswer.name), "kamyshev.me");
  assertEquals(firstAnswer.type, TYPE_A);
  assertEquals(firstAnswer.class, CLASS_IN);
  assertEquals(firstAnswer.ttl, 300);
  /*
   * TODO: Why is it different from
   * https://www.nslookup.io/domains/kamyshev.me/dns-answers/?
   */
  assertEquals(firstAnswer.data, new Uint8Array([188, 114, 97, 3]));

  const secondAnswer = parsed.answers.at(1)!;
  assertEquals(decodeText(secondAnswer.name), "kamyshev.me");
  assertEquals(secondAnswer.type, TYPE_A);
  assertEquals(secondAnswer.class, CLASS_IN);
  assertEquals(secondAnswer.ttl, 300);
  /*
   * TODO: Why is it different from
   * https://www.nslookup.io/domains/kamyshev.me/dns-answers/?
   */
  assertEquals(secondAnswer.data, new Uint8Array([188, 114, 96, 3]));
});
