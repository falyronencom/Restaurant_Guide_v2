Stand-in child modules for src/tests/unit/pdfParseRunner.test.js. Each speaks
the protocol of src/services/ocr/pdfParseChild.js (says { ready: true }, reads
one message) and misbehaves in one way: never answers, burns CPU, grows its
heap, exits without an answer, ends before it is ready, reports how it was
started.
