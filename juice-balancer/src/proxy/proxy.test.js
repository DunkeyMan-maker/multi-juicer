import { jest, beforeEach, test, expect } from '@jest/globals';
import { advanceBy, advanceTo, clear } from 'jest-date-mock';
import request from 'supertest';
import { createApp } from '../app.js';

afterAll(async () => {
  await new Promise((resolve) => setTimeout(() => resolve(), 500)); // avoid jest open handle error
});

let app;
let kubernetesApi;
beforeEach(() => {
  clear();
  kubernetesApi = {
    createDeploymentForTeam: jest.fn(),
    createServiceForTeam: jest.fn(),
    getJuiceShopInstanceForTeamname: jest.fn(() => ({
      readyReplicas: 1,
      availableReplicas: 1,
    })),
    getJuiceShopInstances: jest.fn(),
    deletePodForTeam: jest.fn(),
    updateLastRequestTimestampForTeam: jest.fn(),
    changePasscodeHashForTeam: jest.fn(),
  };
  app = createApp({
    kubernetesApi,
    proxy: {
      web: jest.fn((req, res) => res.send('proxied')),
    },
  });
});

test('/balancer/ should return the balancer ui', async () => {
  await request(app)
    .get('/balancer/')
    // if this returns a 302 locally this is likely caused by not having the frontend compiled. run `npm run build` in `juice-balancer/ui`
    .expect(200)
    .expect('Content-Type', /text\/html/);
});

test('should proxy requests going to JuiceShop when they got a team cookie', async () => {
  await request(app)
    .get('/rest/admin/application-version')
    .set('Cookie', ['balancer=t-team42'])
    .send()
    .expect(200)
    .expect('proxied');
});

test("should redirect to /balancer/ when requests don't have a team cookie", async () => {
  await request(app)
    .get('/rest/admin/application-version')
    .send()
    .expect(302)
    .then((res) => {
      expect(res.header.location).toBe('/balancer/');
    });
});

test('should set the last-connect timestamp when a new team gets proxied the first time', async () => {
  advanceTo(new Date(1555555555555));

  await request(app)
    .get('/rest/admin/application-version')
    .set('Cookie', ['balancer=t-team-last-connect-test'])
    .send()
    .expect(200)
    .expect('proxied');

  expect(kubernetesApi.updateLastRequestTimestampForTeam).toHaveBeenCalledWith(
    'team-last-connect-test'
  );
});

test('should update the last-connect timestamp on requests at most every 10sec', async () => {
  advanceTo(new Date(1000000000000));

  await request(app)
    .get('/rest/admin/application-version')
    .set('Cookie', ['balancer=t-team-update-last-connect-test'])
    .send()
    .expect(200)
    .expect('proxied');

  expect(kubernetesApi.updateLastRequestTimestampForTeam).toHaveBeenCalledWith(
    'team-update-last-connect-test'
  );

  kubernetesApi.updateLastRequestTimestampForTeam.mockClear();

  await request(app)
    .get('/rest/admin/application-version')
    .set('Cookie', ['balancer=t-team-update-last-connect-test'])
    .send()
    .expect(200)
    .expect('proxied');

  expect(kubernetesApi.updateLastRequestTimestampForTeam).not.toHaveBeenCalled();

  // Wait for >10s
  advanceBy(10 * 1000 + 1);

  await request(app)
    .get('/rest/admin/application-version')
    .set('Cookie', ['balancer=t-team-update-last-connect-test'])
    .send()
    .expect(200)
    .expect('proxied');

  expect(kubernetesApi.updateLastRequestTimestampForTeam).toHaveBeenCalledWith(
    'team-update-last-connect-test'
  );
});

test('should only call kubernetesApi.getJuiceShopInstanceForTeamname on requests at most every 10sec', async () => {
  advanceTo(new Date(1000000000000));

  await request(app)
    .get('/rest/admin/application-version')
    .set('Cookie', ['balancer=t-team-get-instance-test'])
    .send()
    .expect(200);

  expect(kubernetesApi.getJuiceShopInstanceForTeamname).toHaveBeenCalled();

  kubernetesApi.getJuiceShopInstanceForTeamname.mockClear();

  await request(app)
    .get('/rest/admin/application-version')
    .set('Cookie', ['balancer=t-team-get-instance-test'])
    .send()
    .expect(200)
    .expect('proxied');

  expect(kubernetesApi.getJuiceShopInstanceForTeamname).not.toHaveBeenCalled();

  // Wait for >10s
  advanceBy(10 * 1000 + 1);

  await request(app)
    .get('/rest/admin/application-version')
    .set('Cookie', ['balancer=t-team-get-instance-test'])
    .send()
    .expect(200)
    .expect('proxied');

  expect(kubernetesApi.getJuiceShopInstanceForTeamname).toHaveBeenCalled();
});

test('should redirect to /balancer/ when the instance is currently restarting', async () => {
  kubernetesApi.getJuiceShopInstanceForTeamname.mockReturnValue({ readyReplicas: 0 });

  await request(app)
    .get('/rest/admin/application-version')
    .set('Cookie', ['balancer=t-restarting-instance'])
    .send()
    .expect(302)
    .then((res) => {
      expect(res.header.location).toBe(
        '/balancer/?msg=instance-restarting&teamname=restarting-instance'
      );
    });
});

test('should redirect to /balancer/ when the instance is not existing', async () => {
  kubernetesApi.getJuiceShopInstanceForTeamname.mockImplementation(() => {
    throw new Error();
  });

  await request(app)
    .get('/rest/admin/application-version')
    .set('Cookie', ['balancer=t-missing-instance'])
    .send()
    .expect(302)
    .then((res) => {
      expect(res.header.location).toBe(
        '/balancer/?msg=instance-not-found&teamname=missing-instance'
      );
    });
});
