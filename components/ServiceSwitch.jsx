import React from 'react';
import { motion } from 'framer-motion';
import styled from 'styled-components';

const SwitchContainer = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 120px;
    margin: 15px;
    perspective: 1000px;
`;

const SwitchLabel = styled.div`
    font-size: 0.8rem;
    text-align: center;
    margin-top: 10px;
    color: #a0aec0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
`;

const SwitchBase = styled.div`
    width: 60px;
    height: 100px;
    background: #2d3748;
    border-radius: 10px;
    box-shadow: 
        inset 0 -2px 10px rgba(0,0,0,0.5),
        0 2px 4px rgba(0,0,0,0.2);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 0;
    cursor: pointer;
`;

const LED = styled.div`
    width: 12px;
    height: 12px;
    border-radius: 50%;
    margin: 5px 0;
    background: ${props => props.active ? '#48BB78' : '#F56565'};
    box-shadow: ${props => props.active 
        ? '0 0 10px #48BB78, 0 0 5px #48BB78'
        : '0 0 10px #F56565, 0 0 5px #F56565'};
`;

const SwitchLever = styled(motion.div)`
    width: 40px;
    height: 60px;
    background: linear-gradient(to right, #718096, #4A5568);
    border-radius: 5px;
    margin-top: 5px;
    box-shadow: 
        -1px 0 2px rgba(0,0,0,0.2),
        1px 0 2px rgba(255,255,255,0.1);
`;

const ServiceSwitch = ({ name, enabled, onToggle, loading }) => {
    const formattedName = name.replace(/_/g, ' ').replace('service', '').trim();

    return (
        <SwitchContainer>
            <SwitchBase onClick={() => !loading && onToggle()}>
                <LED active={enabled} />
                <SwitchLever
                    animate={{ 
                        y: enabled ? -20 : 20,
                        rotateX: enabled ? -20 : 20
                    }}
                    transition={{ 
                        type: "spring",
                        stiffness: 300,
                        damping: 20
                    }}
                    style={{ originY: 0.5 }}
                />
            </SwitchBase>
            <SwitchLabel>{formattedName}</SwitchLabel>
        </SwitchContainer>
    );
};

export default ServiceSwitch; 