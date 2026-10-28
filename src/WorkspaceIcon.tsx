const paths = {
  documents: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5",
  conversation: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
  application: "M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4 M9 15l3-.5L21 5a2.1 2.1 0 0 0-3-3l-9.5 9L8 16z",
  upload: "M12 16V3 M7 8l5-5 5 5 M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4",
  arrow: "M7 17 17 7 M7 7h10v10",
  send: "m22 2-7 20-4-9-9-4 20-7Z M22 2 11 13",
} as const;
export default function WorkspaceIcon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
