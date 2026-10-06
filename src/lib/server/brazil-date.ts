// Investment dates follow the B3 calendar, in Brasília. A UTC date turns at
// 21h there: a page opened in the evening would measure a day that has not
// traded yet, and a refresh would stamp tonight's price on tomorrow.
export function brazilToday(now: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Sao_Paulo'
	}).format(now);
}
