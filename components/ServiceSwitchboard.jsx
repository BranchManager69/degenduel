import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import ServiceSwitch from './ServiceSwitch';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';

const SwitchboardContainer = styled.div`
    background: #1a202c;
    border-radius: 15px;
    padding: 30px;
    box-shadow: 
        0 4px 6px rgba(0, 0, 0, 0.1),
        0 1px 3px rgba(0, 0, 0, 0.08);
    max-width: 800px;
    margin: 20px auto;
`;

const Title = styled.h2`
    color: #e2e8f0;
    text-align: center;
    margin-bottom: 30px;
    font-size: 1.5rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
`;

const SwitchGrid = styled.div`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 20px;
    justify-items: center;
    align-items: start;
    padding: 20px;
    background: #2d3748;
    border-radius: 10px;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
`;

const LoadingOverlay = styled(motion.div)`
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 15px;
`;

const ServiceSwitchboard = () => {
    const [services, setServices] = useState({});
    const [loading, setLoading] = useState(true);
    const [toggleLoading, setToggleLoading] = useState('');

    const fetchServices = async () => {
        try {
            const response = await fetch('/api/superadmin/services/states');
            const data = await response.json();
            if (data.success) {
                setServices(data.services);
            } else {
                toast.error('Failed to fetch service states');
            }
        } catch (error) {
            toast.error('Error fetching service states');
            console.error('Error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = async (serviceName) => {
        setToggleLoading(serviceName);
        try {
            const response = await fetch(`/api/superadmin/services/${serviceName}/toggle`, {
                method: 'POST'
            });
            const data = await response.json();
            if (data.success) {
                setServices(prev => ({
                    ...prev,
                    [serviceName]: data.state
                }));
                toast.success(`${serviceName.replace(/_/g, ' ')} ${data.state.enabled ? 'enabled' : 'disabled'}`);
            } else {
                toast.error('Failed to toggle service');
            }
        } catch (error) {
            toast.error('Error toggling service');
            console.error('Error:', error);
        } finally {
            setToggleLoading('');
        }
    };

    useEffect(() => {
        fetchServices();
        const interval = setInterval(fetchServices, 30000); // Refresh every 30 seconds
        return () => clearInterval(interval);
    }, []);

    return (
        <SwitchboardContainer>
            <Title>Service Control Panel</Title>
            <SwitchGrid>
                {Object.entries(services).map(([name, state]) => (
                    <ServiceSwitch
                        key={name}
                        name={name}
                        enabled={state.enabled}
                        onToggle={() => handleToggle(name)}
                        loading={toggleLoading === name}
                    />
                ))}
            </SwitchGrid>
            {loading && (
                <LoadingOverlay
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    <span>Loading...</span>
                </LoadingOverlay>
            )}
        </SwitchboardContainer>
    );
};

export default ServiceSwitchboard; 