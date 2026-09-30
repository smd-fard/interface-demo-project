import { describe, expect, it } from 'vitest';
import { esc, formRow, nest, page, redMessage, select, submit, textInput } from './legacy.js';

describe('legacy html helpers', () => {
	it('escapes text and attribute values', () => {
		expect(esc(`<b>"Tom" & 'Jerry'</b>`)).toBe('&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
		expect(textInput('txt1', { value: '"><script>' })).toContain('value="&quot;&gt;&lt;script&gt;"');
		expect(redMessage('<x>')).toBe('<font color="red">&lt;x&gt;</font>');
		expect(select('s', ['A&B'])).toBe('<select name="s"><option>A&amp;B</option></select>');
	});

	it('puts the label in the cell adjacent to the control', () => {
		expect(formRow('Member #', textInput('txt1'))).toBe(
			'<tr><td width="140" nowrap>Member #</td><td><input type="text" name="txt1" size="20" value=""></td></tr>',
		);
	});

	it('nests layout tables to the requested depth', () => {
		expect(nest('x', 4).match(/<table/g)).toHaveLength(4);
	});

	it('renders submit buttons with an optional inline handler', () => {
		expect(submit('btnGo', 'Search')).toBe('<input type="submit" name="btnGo" value="Search">');
		expect(submit('b', 'OK', "return window.confirm('Sure?')")).toContain(`onclick="return window.confirm('Sure?')"`);
	});

	it('never emits ids, test ids or ARIA', () => {
		const html = page({ title: 't', body: nest(formRow('L', textInput('n')) + submit('b', 'Go')) });
		expect(html).not.toMatch(/\sid=|data-testid|aria-|role=|<label/i);
	});
});
