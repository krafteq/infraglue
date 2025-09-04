import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'

// Get configuration values
const config = new pulumi.Config('redis')
const redisPort = config.get('redis_port') || '6379'
const redisPassword = config.get('redis_password') || 'your-redis-password'
const redisVersion = config.get('redis_version') || '7.2-alpine'
const containerName = config.get('container_name') || 'redis-server'
const networkName = config.get('network_name')

if (!networkName) {
  throw new Error('Network name is required')
}

// Create Redis container
const redisContainer = new docker.Container('redis-container', {
  name: containerName,
  image: `redis:${redisVersion}`,
  networksAdvanced: [
    {
      name: networkName,
    },
  ],
  ports: [
    {
      internal: 6379,
      external: parseInt(redisPort),
    },
  ],
  envs: [`REDIS_PASSWORD=${redisPassword}`],
  restart: 'unless-stopped',
  labels: [
    {
      label: 'project',
      value: 'redis-example',
    },
    {
      label: 'service',
      value: 'redis',
    },
  ],
})

// Export the Redis connection details
export const redis_host = 'localhost'
export const redis_port = redisPort
export const redis_password = redisPassword
export const redis_container_name = redisContainer.name
export const redis_connection_string = `redis://:${redisPassword}@localhost:${redisPort}`
