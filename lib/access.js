/*
Data lifetime:
- Raw text: access phrase only while reading input value.
- Disk: none.
- Network: none.
*/
export function createAccessGate({ getValue }) {
  const read = () => getValue().trim();

  const request = ({ onMissing } = {}) => {
    const value = read();
    if (!value) {
      if (onMissing) {
        onMissing();
      }
      return { ok: false, value: "" };
    }
    return { ok: true, value };
  };

  return {
    read,
    request,
  };
}
