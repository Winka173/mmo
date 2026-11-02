import {describe,it,expect} from 'vitest';
import {parsePublicFeed} from '../src/public-feed.js';
describe('Offered public feed metadata only',()=>{
 it('reads RSS CDATA and dates, normalizes tracking and never follows enclosures',()=>{
  const items=parsePublicFeed('<rss><channel><item><title><![CDATA[Topic &amp; news]]></title><link>https://publisher.example/story?utm_source=feed&amp;id=2#top</link><description><![CDATA[<b>Summary</b>]]></description><pubDate>Fri, 23 Oct 2026 00:00:00 GMT</pubDate><enclosure url="http://127.0.0.1/private.mp4"/></item></channel></rss>','https://publisher.example/feed');
  expect(items).toHaveLength(1);expect(items[0]).toMatchObject({title:'Topic & news',summary:'Summary',url:'https://publisher.example/story?id=2',publishedAt:'2026-10-23T00:00:00.000Z'});expect(JSON.stringify(items)).not.toContain('private.mp4');
 });
 it('supports Atom alternate links/relative URLs and ignores private, HTTP or malformed entries',()=>{
  const items=parsePublicFeed(`<feed><entry><title>Atom</title><link rel='self' href='https://publisher.example/api'/><link href='/story' rel='alternate'/><updated>2026-10-22T00:00:00Z</updated></entry><entry><title>Private</title><link href='https://127.0.0.1/secret'/></entry><entry><title>HTTP</title><link href='http://publisher.example/post'/></entry></feed>`,'https://publisher.example/feed');expect(items).toHaveLength(1);expect(items[0].url).toBe('https://publisher.example/story');
 });
 it('deduplicates canonical URLs, bounds entries, rejects HTML and entity declarations',()=>{
  const item='<item><title>Same</title><link>https://publisher.example/story</link></item>';expect(parsePublicFeed(`<rss>${item}${item}</rss>`,'https://publisher.example/feed')).toHaveLength(1);
  expect(()=>parsePublicFeed('<html>not a feed</html>','https://publisher.example/feed')).toThrow('not an offered');expect(()=>parsePublicFeed('<!DOCTYPE rss [<!ENTITY e SYSTEM "file:///secret">]><rss/>','https://publisher.example/feed')).toThrow('entities');
  expect(()=>parsePublicFeed('<rss>'+ 'x'.repeat(2*1024*1024)+'</rss>','https://publisher.example/feed')).toThrow('bounds');
 });
});
