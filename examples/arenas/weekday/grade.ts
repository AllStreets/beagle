// Full marks for the right day, nothing for any other.
export default (answer: { day?: string } | null, truth: { day: string }) => String(answer?.day ?? '').toLowerCase() === truth.day.toLowerCase() ? 1 : 0;
