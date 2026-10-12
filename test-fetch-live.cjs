fetch('https://interview-copilot-bs5.pages.dev/api/answer', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: 'hello' })
}).then(res => {
  console.log("STATUS:", res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  function read() {
    reader.read().then(({done, value}) => {
      if (done) {
        console.log("DONE");
        return;
      }
      console.log(decoder.decode(value));
      read();
    });
  }
  read();
}).catch(console.error);
