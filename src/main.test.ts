import axios from 'axios';
import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import proxyquire from 'proxyquire';
import * as sinon from 'sinon';
import { COMMANDS, HELP } from './lib/help';

class MockAdapter {
    public config: { url: string; token: string };
    public name = 'gotify';
    public instance = 0;
    public log = {
        debug: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
    };
    public setState = sinon.stub().resolves();
    public getForeignObjectAsync = sinon.stub().resolves(null);
    public extendForeignObjectAsync = sinon.stub().resolves();
    public sendTo = sinon.stub();
    public decrypt = sinon.stub().callsFake((value: string) => value);
    public encrypt = sinon.stub().callsFake((value: string) => `$/aes-${value}`);
    public supportsFeature = sinon.stub().returns(true);
    public on = sinon.stub();

    public constructor(options: { config?: { url: string; token: string } }) {
        this.config = options.config ?? { url: 'https://gotify.example.com', token: 'test-token-123' };
    }
}

const createAdapter: (options?: { config?: { url: string; token: string } }) => any = proxyquire.noCallThru()(
    './main',
    {
        '@iobroker/adapter-core': { Adapter: MockAdapter },
    },
);

describe('Gotify adapter', () => {
    let axiosPostStub: sinon.SinonStub;
    let axiosGetStub: sinon.SinonStub;

    beforeEach(() => {
        axiosPostStub = sinon.stub(axios, 'post').resolves({ data: { id: 1 } });
        axiosGetStub = sinon.stub(axios, 'get').resolves({ data: { health: 'OK' } });
    });

    afterEach(() => {
        axiosPostStub.restore();
        axiosGetStub.restore();
    });

    it('sends the token in the auth header and awaits successful delivery', async () => {
        const adapter = createAdapter();
        const sent = await adapter.sendMessage({ title: 'Test', message: 'Hello', priority: 5 });

        expect(sent).to.equal(true);
        expect(axiosPostStub.firstCall.args[0]).to.equal('https://gotify.example.com/message');
        expect(axiosPostStub.firstCall.args[1]).not.to.have.property('token');
        expect(axiosPostStub.firstCall.args[2]).to.deep.include({
            timeout: 1000,
            headers: { 'X-Gotify-Key': 'test-token-123' },
        });
        expect(adapter.setState.calledWith('info.lastSuccess', sinon.match.number, true)).to.equal(true);
        expect(adapter.setState.calledWith('info.lastError', '', true)).to.equal(true);
    });

    it('does not expose a failed request token in logs or the URL', async () => {
        const customToken = 'custom-token-456';
        const adapter = createAdapter();
        axiosPostStub.rejects({ isAxiosError: true, response: { status: 401 } });

        const sent = await adapter.sendMessage({ message: 'Hello', token: customToken });

        expect(sent).to.equal(false);
        expect(axiosPostStub.firstCall.args[0]).not.to.include(customToken);
        expect(adapter.log.error.firstCall.args.join(' ')).not.to.include(customToken);
        expect(adapter.setState.calledWith('info.lastError', 'HTTP 401', true)).to.equal(true);
    });

    it('migrates a plaintext token without replacing the runtime token', async () => {
        const adapter = createAdapter({ config: { url: 'https://gotify.example.com', token: 'plain-token' } });
        const instanceObject = { native: { token: 'plain-token' } };
        adapter.getForeignObjectAsync.resolves(instanceObject);

        await adapter.encryptPrivateKeyIfNeeded();

        expect(adapter.config.token).to.equal('plain-token');
        expect(instanceObject.native.token).to.equal('$/aes-plain-token');
        expect(adapter.extendForeignObjectAsync.calledOnce).to.equal(true);
    });

    it('reports send completion in the message callback', async () => {
        const adapter = createAdapter();
        axiosPostStub.rejects(new Error('Network Error'));

        await adapter.onMessage({
            command: 'send',
            message: { title: 'Test', message: 'Hello' },
            from: 'javascript.0',
            callback: 1,
        });

        expect(adapter.sendTo.firstCall.args[2]).to.deep.equal({ sent: false });
    });

    it('answers help also without a configured server', async () => {
        const adapter = createAdapter({ config: { url: '', token: '' } });

        await adapter.onMessage({ command: 'help', message: {}, from: 'javascript.0', callback: 1 });

        expect(adapter.sendTo.firstCall.args[2]).to.deep.equal({ help: HELP, commands: COMMANDS });
        expect(axiosPostStub.called).to.equal(false);
    });

    it('lists in help exactly the commands onMessage answers', () => {
        const source = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
        const handler = source.slice(
            source.indexOf('private async onMessage('),
            source.indexOf('private async processNotification('),
        );
        const answered = [...new Set([...handler.matchAll(/obj\.command === '([^']+)'/g)].map(m => m[1]))];
        const names = COMMANDS.map(c => c.command);

        expect(new Set(names).size).to.equal(names.length);
        expect([...names].sort()).to.deep.equal(answered.sort());
        for (const { command, write } of COMMANDS) {
            expect(write, command).to.equal(command !== 'help');
            if (command !== 'help') {
                expect(HELP).to.include(`- ${command}`);
            }
        }
        for (const line of HELP.split('\n')) {
            expect(line.length, line).to.be.at.most(120);
        }
    });

    it('marks send as message.send of the shared catalog', () => {
        const marks = Object.fromEntries(COMMANDS.filter(c => c.standard).map(c => [c.command, c.standard]));

        expect(marks).to.deep.equal({ send: 'message.send' });
        expect(HELP).to.include('message.send');
    });

    it('sends the catalog form {text, title, priority} and answers {ok, sent}', async () => {
        const adapter = createAdapter();

        await adapter.onMessage({
            command: 'send',
            message: { text: 'Door open', title: 'Alarm', priority: true },
            from: 'assistant.0',
            callback: 1,
        });

        expect(axiosPostStub.firstCall.args[1]).to.deep.include({ message: 'Door open', title: 'Alarm', priority: 8 });
        expect(adapter.sendTo.firstCall.args[2]).to.deep.equal({ ok: true, sent: 1 });
    });

    it('answers the catalog form with error and reason', async () => {
        const adapter = createAdapter();
        axiosPostStub.rejects({ isAxiosError: true, response: { status: 401 } });
        const ask = async (message: Record<string, unknown>): Promise<any> => {
            adapter.sendTo.resetHistory();
            await adapter.onMessage({ command: 'send', message, from: 'assistant.0', callback: 1 });
            return adapter.sendTo.firstCall.args[2];
        };

        expect(await ask({ text: 'Hello' })).to.deep.equal({ error: 'HTTP 401', reason: 'NOT_ALLOWED' });
        expect((await ask({ text: 'Hello', recipient: 'Anna' })).reason).to.equal('NOT_SUPPORTED');
        expect((await ask({ text: 'Hello', file: 'data:image/png;base64,AAAA' })).reason).to.equal('NOT_SUPPORTED');
        expect((await ask({ text: '' })).reason).to.equal('BAD_REQUEST');
        expect(axiosPostStub.callCount).to.equal(1);

        const unconfigured = createAdapter({ config: { url: '', token: '' } });
        await unconfigured.onMessage({ command: 'send', message: { text: 'Hello' }, from: 'assistant.0', callback: 1 });
        expect(unconfigured.sendTo.firstCall.args[2]).to.deep.equal({
            error: 'Gotify is not configured',
            reason: 'NOT_CONFIGURED',
        });
    });

    it('keeps the answer {sent} of the old form and answers unknown commands', async () => {
        const adapter = createAdapter();

        await adapter.onMessage({ command: 'send', message: { message: 'Hello' }, from: 'javascript.0', callback: 1 });
        await adapter.onMessage({ command: 'foo', message: {}, from: 'javascript.0', callback: 1 });

        expect(adapter.sendTo.firstCall.args[2]).to.deep.equal({ sent: true });
        expect(adapter.sendTo.secondCall.args[2]).to.deep.include({ reason: 'NOT_SUPPORTED' });
    });

    it('checks server availability without logging the configured token', async () => {
        const adapter = createAdapter();

        await adapter.onReady();

        expect(axiosGetStub.firstCall.args[0]).to.equal('https://gotify.example.com/health');
        expect(adapter.setState.firstCall.args).to.deep.equal(['info.connection', false, true]);
        expect(adapter.setState.calledWith('info.connection', true, true)).to.equal(true);
        expect(JSON.stringify(adapter.log.debug.args)).not.to.include('test-token-123');
    });

    it('keeps the adapter status off when the health check fails', async () => {
        const adapter = createAdapter();
        axiosGetStub.rejects({ isAxiosError: true, response: { status: 503 } });

        await adapter.onReady();

        expect(adapter.setState.calledWith('info.connection', false, true)).to.equal(true);
        expect(adapter.setState.calledWith('info.connection', true, true)).to.equal(false);
        expect(adapter.setState.calledWith('info.lastError', 'HTTP 503', true)).to.equal(true);
    });
});
