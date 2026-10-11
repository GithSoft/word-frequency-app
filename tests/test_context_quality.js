const { extractContexts } = require('../src/analyzer');
const assert = require('assert');

console.log('🧪 Testing Smart Context Selection...');

const targetWord = 'fox';
const noisyText = `
The quick brown fox jumps over the lazy dog. 
....... This is garbage ......
Foxes are great.
the fox.
A quick fox runs fast!
Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing sem neque sed ipsum. Nam quam nunc, blandit vel, luctus pulvinar, hendrerit id, lorem. Maecenas nec odio et ante tincidunt tempus. Donec vitae sapien ut libero venenatis faucibus. Nullam quis ante. Etiam sit amet orci eget eros faucibus tincidunt. Duis leo. Sed fringilla mauris sit amet nibh. Donec sodales sagittis magna. Sed consequat, leo eget bibendum sodales, augue velit cursus nunc, 
This is a perfectly good sentence about a fox.
....... context . ... .
bad context fox
`;

async function run() {
    const contexts = await extractContexts(noisyText, [targetWord], { caseSensitive: false });
    const results = contexts.get(targetWord);

    console.log('\nSelected Contexts:');
    results.forEach((c, i) => console.log(`${i + 1}. ${c}`));

    // Tests
    try {
        // 1. Check garbage removal
        const hasGarbage = results.some(c => c.includes('.......'));
        assert.strictEqual(hasGarbage, false, '❌ Garbage "......" should be filtered out');
        console.log('✅ Passed: Garbage filtering');

        // 2. Check long sentence removal (Lorem Ipsum)
        const hasLorem = results.some(c => c.startsWith('Lorem ipsum'));
        assert.strictEqual(hasLorem, false, '❌ Long Lorem Ipsum text should be filtered out');
        console.log('✅ Passed: Length filtering');

        // 3. Check prioritization (Best sentence first)
        // "The quick brown fox..." starts with Capital, ends with dot, good length.
        // "This is a perfectly good sentence about a fox." is also good.
        const first = results[0];
        assert.ok(/^[A-T]/.test(first), '❌ First result should be capitalized');
        assert.ok(first.length > 20, '❌ First result should have decent length');
        console.log('✅ Passed: Scoring prioritization');

    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }

    console.log('\n🎉 All Context Quality Tests Passed!');
}

run();
