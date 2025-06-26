import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'

// Get configuration values
const config = new pulumi.Config()
const networkName = config.get('network_name') || 'app-network'
const projectName = config.get('project_name') || 'terraform-example'

// Create a Docker network
const network = new docker.Network('network', {
  name: networkName,
  driver: 'bridge',
  labels: [
    {
      label: 'project',
      value: projectName,
    },
  ],
})

// Export the network name
export const network_name = network.name
