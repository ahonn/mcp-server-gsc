import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchProperty, resolveSiteUrl } from '../src/site-resolver.js';

const properties = [
  'sc-domain:example.com',
  'https://www.example.com/',
  'https://www.example.com/blog/',
  'http://legacy.test/',
  'https://www.prefix-only.test/',
];

test('matchProperty keeps an exact property', () => {
  assert.equal(matchProperty('https://www.example.com/', properties), 'https://www.example.com/');
  assert.equal(matchProperty('https://www.example.com', properties), 'https://www.example.com/');
});

test('matchProperty maps a bare domain to the domain property', () => {
  assert.equal(matchProperty('example.com', properties), 'sc-domain:example.com');
  assert.equal(matchProperty('docs.example.com', properties), 'sc-domain:example.com');
});

test('matchProperty uses the closest URL prefix for a page URL', () => {
  assert.equal(matchProperty('https://www.example.com/blog/post', properties), 'https://www.example.com/blog/');
  assert.equal(matchProperty('https://www.example.com/about', properties), 'https://www.example.com/');
  assert.equal(matchProperty('https://docs.example.com/a', properties), 'sc-domain:example.com');
});

test('matchProperty respects the URL scheme of a prefix property', () => {
  assert.equal(matchProperty('http://legacy.test/page', properties), 'http://legacy.test/');
  assert.equal(matchProperty('https://legacy.test/page', properties), null);
});

test('matchProperty finds a www prefix for a bare domain', () => {
  assert.equal(matchProperty('prefix-only.test', properties), 'https://www.prefix-only.test/');
});

test('matchProperty does not match a lookalike domain', () => {
  assert.equal(matchProperty('notexample.com', properties), null);
  assert.equal(matchProperty('https://www.example.com.evil.test/', properties), null);
  assert.equal(matchProperty('https://www.example.com/blogger', ['https://www.example.com/blog/']), null);
});

test('resolveSiteUrl skips the lookup for a domain property', async () => {
  let listed = false;
  const site = await resolveSiteUrl('sc-domain:example.com', async () => {
    listed = true;
    return [];
  });
  assert.equal(site, 'sc-domain:example.com');
  assert.equal(listed, false);
});
