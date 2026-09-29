function toggleMsisdn() {
  const span = document.getElementById('msisdn-text');
  const hidden = document.getElementById('msisdn-full');
  if (!span || !hidden) return;
  if (span.textContent === '••••••••••') {
    span.textContent = hidden.value;
  } else {
    span.textContent = '••••••••••';
  }
}
